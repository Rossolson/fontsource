const _ = require(`lodash`)
const async = require(`async`)
const flatten = require(`flat`)
const fs = require(`fs-extra`)
const isAbsoluteUrl = require(`is-absolute-url`)
const jsonfile = require(`jsonfile`)
const apiFont = require(`google-font-metadata/data/google-fonts-v1.json`)

const download = require(`./download-file`)
const { fontFace } = require(`./templates`)

const id = process.argv[2]
if (!id) {
  console.warn(`Google Font ID has not been passed into packager.`)
  process.exit()
}
const force = process.argv[3]

const font = apiFont[id]

// Set file directories
const fontDir = `packages/${font.id}`
fs.ensureDirSync(fontDir)
fs.ensureDirSync(`scripts/temp_packages`)

// Update checking
let changed = false

if (fs.existsSync(`${fontDir}/metadata.json`)) {
  let metadata = jsonfile.readFileSync(`${fontDir}/metadata.json`)
  changed = metadata.lastModified !== font.lastModified
} else {
  changed = true
}

// Processing each subset of given font ID.
if (changed || force == "force") {
  // Wipe old font files preserving package.json
  if (fs.existsSync(`${fontDir}/package.json`)) {
    fs.copySync(
      `./${fontDir}/package.json`,
      `./scripts/temp_packages/${font.id}-package.json`
    )
    fs.emptyDirSync(fontDir)
    fs.copySync(
      `./scripts/temp_packages/${font.id}-package.json`,
      `./${fontDir}/package.json`
    )
    fs.removeSync(`./scripts/temp_packages/${font.id}-package.json`)
  }

  fs.ensureDirSync(`./${fontDir}/files`)

  // Generate filenames
  const makeFontDownloadPath = (subset, weight, style, extension) => {
    return `./${fontDir}/files/${font.id}-${subset}-${weight}-${style}.${extension}`
  }

  const makeFontFilePath = (subset, weight, style, extension) => {
    return `./files/${font.id}-${subset}-${weight}-${style}.${extension}`
  }

  // Parse API and split into variant + link array pairs. [['weight.style.subset.url|local.extension','link to font or local name'],...]
  const downloadURLPairs = _.toPairs(flatten(font.variants))

  // Filter out local font links and only leave URLs for each pair
  const links = downloadURLPairs
    .filter(pair => isAbsoluteUrl(pair[1].toString()))
    .filter(file => {
      const extension = file[0].split(".")[4]
      if (extension == "truetype" || extension == "opentype") {
        return false
      } else {
        return true
      }
    })
    .map(file => {
      const types = file[0].split(".")
      const dest = makeFontDownloadPath(types[2], types[0], types[1], types[4])
      const url = file[1]
      return {
        url,
        dest,
      }
    })

  // Download all font files
  async.map(links, (d, downloadDone) => {
    const { url, dest } = d
    download(url, dest, err => {
      if (err) {
        console.log("Error downloading", font.id, url, err)
      }
      downloadDone()
    })
  })

  // Generate CSS
  font.subsets.forEach(subset => {
    cssSubset = []
    font.weights.forEach(weight => {
      cssWeight = []
      font.styles.forEach(style => {
        // Some fonts may have variants 400, 400i, 700 but not 700i.
        if (style in font.variants[weight]) {
          let css = fontFace({
            fontId: font.id,
            fontName: font.family,
            locals: font.variants[weight][style][subset].local,
            style,
            subset,
            weight,
            woff2Path: makeFontFilePath(subset, weight, style, "woff2"),
            woffPath: makeFontFilePath(subset, weight, style, "woff"),
          })
          cssWeight.push(css)
          cssSubset.push(css)

          const cssStylePath = `${fontDir}/${subset}-${weight}-${style}.css`
          fs.writeFileSync(cssStylePath, css)
        }
      })
      const cssWeightPath = `${fontDir}/${subset}-${weight}.css`
      fs.writeFileSync(cssWeightPath, cssWeight.join(""))
    })
    const cssSubsetPath = `${fontDir}/${subset}.css`
    fs.writeFileSync(cssSubsetPath, cssSubset.join(""))
  })
}

console.log(`Finished processing ${font.id}`)
