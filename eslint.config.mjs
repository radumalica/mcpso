import next from "eslint-config-next/core-web-vitals";

export default [
  ...next,
  { ignores: [".next/**", "node_modules/**", "db/tests/node_modules/**", "data/**", "reports/**"] },
  {
    // Style-only rules that the inherited template violates everywhere; the public-site rewrite (Phase D) replaces those components.
    rules: { "react/display-name": "off", "import/no-anonymous-default-export": "off" },
  },
];
