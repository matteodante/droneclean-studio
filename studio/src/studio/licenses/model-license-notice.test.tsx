import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { changeAppLanguage, i18n } from "@/i18n";
import { ModelLicenseNotice } from "./model-license-notice";

describe("ModelLicenseNotice", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("says MusicGen is non-commercial and links the CC BY-NC 4.0 licence", () => {
    render(<ModelLicenseNotice model="musicgen" />);
    expect(
      screen.getByText(/for non-commercial use only \(CC BY-NC 4\.0\)/, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://creativecommons.org/licenses/by-nc/4.0/",
    );
  });

  it("names Supertonic OpenRAIL-M licence, its restrictions and its licence page", () => {
    render(<ModelLicenseNotice model="supertonic" />);
    expect(
      screen.getByText(/OpenRAIL-M licence, which forbids some uses/),
    ).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://huggingface.co/Supertone/supertonic-3",
    );
  });

  it("translates the notices", async () => {
    await changeAppLanguage("de");
    render(<ModelLicenseNotice model="musicgen" />);
    expect(screen.getByText(/nicht-kommerziell/)).toBeTruthy();
    await i18n.changeLanguage("en");
  });
});
