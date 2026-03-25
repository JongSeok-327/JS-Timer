const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: {
    "service-worker": "./src/background/service-worker.ts",
    popup: "./src/popup/popup.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "public/manifest.json",
          to: "manifest.json",
        },
        {
          from: "public/icons",
          to: "icons",
          noErrorOnMissing: true,
        },
        {
          from: "src/popup/popup.html",
          to: "popup.html",
        },
        {
          from: "src/popup/popup.css",
          to: "popup.css",
        },
      ],
    }),
  ],
  optimization: {
    minimize: true,
  },
};
