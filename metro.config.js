const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Serve the website stylesheet from the in-app LAN server as a bundled asset.
config.resolver.assetExts.push("css");

module.exports = config;
