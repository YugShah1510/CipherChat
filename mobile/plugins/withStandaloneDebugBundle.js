const { withAppBuildGradle } = require('expo/config-plugins')

/**
 * Make the local debug APK usable without a running Metro server.
 * React Native normally omits its JavaScript bundle from the debuggable
 * variant, which leaves an installed standalone APK waiting at the splash.
 */
module.exports = function withStandaloneDebugBundle(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('CipherChat Android build expects a Groovy app/build.gradle file.')
    }

    const contents = mod.modResults.contents
    const assignment = '    debuggableVariants = [] // CipherChat standalone debug APK'
    if (contents.includes(assignment)) return mod

    const bundleCommand = '    bundleCommand = "export:embed"'
    if (!contents.includes(bundleCommand)) {
      throw new Error('Could not find the React Native bundle configuration in app/build.gradle.')
    }

    // An empty list tells React Native to embed JS for debug instead of relying on Metro.
    mod.modResults.contents = contents.replace(
      bundleCommand,
      `${bundleCommand}\n${assignment}`
    )
    return mod
  })
}
