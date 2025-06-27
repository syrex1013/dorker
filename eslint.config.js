import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        Buffer: "readonly",
        process: "readonly",
      },
      ecmaVersion: 2024,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern:
            "^_|^e$|^err$|^error$|^i$|^index$|^mutations$|^audioUrl$",
          varsIgnorePattern:
            "^_|GOOGLE_CONSENT_SCRIPT|VIEWPORTS|originalNotification|nativeToStringFunctionString|newTestError|captchaElements|downloadAudio|testUrl|searchQuery",
          caughtErrorsIgnorePattern: "^_|^e$|^err$|^error$|^newTestError$",
        },
      ],
      "no-global-assign": "off",
      "no-self-assign": "off",
      "no-undef": ["error", { typeof: false }],
    },
  },
];
