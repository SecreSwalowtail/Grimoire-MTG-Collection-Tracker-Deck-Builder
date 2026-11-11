// Sets the app's version everywhere a build reads it, and the Android versionCode to a number
// made from all three parts (1.1.0 → 10100, 1.2.3 → 10203). Android only installs an update whose
// versionCode is higher than the installed one's, so it has to grow with every version: counting
// from the patch number alone gave 1.1.0 a lower code than 1.0.3, and the update was refused.
//
//   npm run set-version 1.0.2
//
// Then rebuild (the android/ folder is regenerated, so it picks up the new numbers) and tag the
// GitHub release "v1.0.2": the in-app update check compares that tag with app.json's version.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const version = (process.argv[2] ?? '').replace(/^v/i, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run set-version <major.minor.patch>, e.g. npm run set-version 1.0.2')
  process.exit(1)
}

// Rewrites a JSON file in place, keeping its indentation and line endings.
function editJson(file, change) {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) return
  const text = fs.readFileSync(full, 'utf8')
  const json = JSON.parse(text)
  change(json)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  fs.writeFileSync(full, JSON.stringify(json, null, 2).replace(/\n/g, eol) + eol)
}

const [major, minor, patch] = version.split('.').map(Number)
if (minor > 99 || patch > 99) {
  console.error('The minor and patch numbers go up to 99.')
  process.exit(1)
}
const versionCode = major * 10000 + minor * 100 + patch
editJson('app.json', (app) => {
  const previous = app.expo.version
  app.expo.android ??= {}
  app.expo.version = version
  app.expo.android.versionCode = versionCode
  console.log(`app.json: ${previous} → ${version}, versionCode ${versionCode}`)
})
editJson('package.json', (pkg) => {
  pkg.version = version
})
editJson('package-lock.json', (lock) => {
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
})

// A generated android/ folder already on disk keeps its old numbers until regenerated; update it
// too, so a plain gradle build is right as well.
const gradle = path.join(root, 'android', 'app', 'build.gradle')
if (fs.existsSync(gradle)) {
  const text = fs.readFileSync(gradle, 'utf8')
  fs.writeFileSync(
    gradle,
    text
      .replace(/versionCode \d+/, `versionCode ${versionCode}`)
      .replace(/versionName "[^"]*"/, `versionName "${version}"`),
  )
  console.log('android/app/build.gradle updated')
}

console.log(`Done. Rebuild, then publish the GitHub release tagged v${version}.`)
