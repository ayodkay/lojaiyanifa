import { describe, expect, it } from "vitest";

import { emulatorEnvFile, productionEnvProblems } from "../../scripts/functions-env.mjs";

/** A deployable file. The key is a neutral fake. */
const VALID = {
  SITE_URL: "https://lojaiyanifa.web.app",
  PRISMIC_REPO: "lojaiyanifa",
  PRISMIC_LOCALE: "pt-br",
  WEB_API_KEY: "test-web-api-key",
  WEB_AUTH_DOMAIN: "lojaiyanifa.firebaseapp.com",
  ADMIN_REQUIRE_MFA: "true",
};

const file = (vars: Record<string, string>, extra = "") =>
  `# production\n${Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n${extra}`;

describe("productionEnvProblems", () => {
  it("accepts a complete production file, comments included", () => {
    expect(productionEnvProblems(file(VALID))).toEqual([]);
  });

  it("refuses emulator variables, the emulator flag and a local credentials file", () => {
    const forbidden = {
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FUNCTIONS_EMULATOR: "true",
      GOOGLE_APPLICATION_CREDENTIALS: "C:/keys/service-account.json",
    };
    const problems = productionEnvProblems(file({ ...VALID, ...forbidden }));
    expect(problems).toHaveLength(4);
    for (const key of Object.keys(forbidden)) {
      expect(problems.filter((p) => p.startsWith(`${key} must not be deployed`))).toHaveLength(1);
    }
  });

  it("keeps the SMTP key out of the deployed env file (it belongs in Secret Manager); the rest of the mail settings may go", () => {
    const mail = { MAIL_FROM: "Loja <pedidos@loja.example>", MAIL_STORE_TO: "dono@exemplo.com", SMTP_USER: "login@smtp-brevo.com" };
    expect(productionEnvProblems(file({ ...VALID, ...mail }))).toEqual([]);
    const problems = productionEnvProblems(file({ ...VALID, ...mail, SMTP_PASSWORD: "xsmtpsib-fake" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^SMTP_PASSWORD must not be deployed: .*functions:secrets:set SMTP_PASSWORD/);
    expect(problems[0]).not.toContain("xsmtpsib-fake");
  });

  it("names the variables the Firebase CLI would refuse, such as the old FIREBASE_WEB_API_KEY", () => {
    const reserved = { FIREBASE_WEB_API_KEY: "x", FIREBASE_AUTH_DOMAIN: "x", X_GOOGLE_SETTING: "x", EXT_SETTING: "x" };
    const problems = productionEnvProblems(file({ ...VALID, ...reserved }));
    // node:util parseEnv returns keys sorted, not in file order.
    expect(problems.map((p) => p.split(":")[0]).sort()).toEqual(Object.keys(reserved).sort());
    expect(problems.every((p) => p.endsWith("rename it"))).toBe(true);
  });

  it("requires an https SITE_URL with no path, and ADMIN_REQUIRE_MFA=true", () => {
    for (const site of ["http://lojaiyanifa.web.app", "https://lojaiyanifa.web.app/loja", "localhost:5173"]) {
      expect(productionEnvProblems(file({ ...VALID, SITE_URL: site }))).toEqual([`SITE_URL must be an https origin with no path, got "${site}"`]);
    }
    expect(productionEnvProblems(file({ ...VALID, SITE_URL: "https://lojaiyanifa.web.app/" }))).toEqual([]);
    expect(productionEnvProblems(file({ ...VALID, ADMIN_REQUIRE_MFA: "false" }))).toEqual([
      'ADMIN_REQUIRE_MFA must be "true" in production, got "false"',
    ]);
  });

  it("lists every missing or empty variable", () => {
    expect(productionEnvProblems(file({ SITE_URL: VALID.SITE_URL, WEB_API_KEY: "" }))).toEqual([
      "PRISMIC_REPO is missing or empty",
      "PRISMIC_LOCALE is missing or empty",
      "WEB_API_KEY is missing or empty",
      "WEB_AUTH_DOMAIN is missing or empty",
      "ADMIN_REQUIRE_MFA is missing or empty",
    ]);
  });

  it("keeps tokens out: secrets belong in Secret Manager", () => {
    const problems = productionEnvProblems(file({ ...VALID, PRISMIC_WRITE_TOKEN: "x", PRISMIC_ACCESS_TOKEN: "x" }));
    expect(problems.map((p) => p.split(" ")[0]).sort()).toEqual(["PRISMIC_ACCESS_TOKEN", "PRISMIC_WRITE_TOKEN"]);
    expect(problems.every((p) => p.includes("Secret Manager"))).toBe(true);
  });
});

describe("emulatorEnvFile", () => {
  it("drops the names the Firebase CLI refuses and keeps every other line as written", () => {
    const local = [
      "# development",
      "SITE_URL=http://localhost:5173",
      'STORE_PIX_NAME="Loja Teste"',
      "FIREBASE_PROJECT_ID=demo-lojaiyanifa",
      "FIRESTORE_EMULATOR_HOST=127.0.0.1:8180",
      "export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099",
      "",
      "PRISMIC_REPO=lojaiyanifa",
      "",
    ].join("\r\n");
    const { text, dropped } = emulatorEnvFile(local);
    expect(dropped).toEqual(["FIREBASE_PROJECT_ID", "FIREBASE_AUTH_EMULATOR_HOST"]);
    expect(text).toBe(
      ["# development", "SITE_URL=http://localhost:5173", 'STORE_PIX_NAME="Loja Teste"', "FIRESTORE_EMULATOR_HOST=127.0.0.1:8180", "", "PRISMIC_REPO=lojaiyanifa", ""].join(
        "\r\n",
      ),
    );
  });

  it("goes by the name alone, for every prefix the CLI refuses", () => {
    const { text, dropped } = emulatorEnvFile("NOTE=FIREBASE_X\nX_GOOGLE_A=1\nEXT_B=2\nFIREBASEX=3\n  FIREBASE_C = 4\n");
    expect(dropped).toEqual(["X_GOOGLE_A", "EXT_B", "FIREBASE_C"]);
    expect(text).toBe("NOTE=FIREBASE_X\nFIREBASEX=3\n");
  });
});
