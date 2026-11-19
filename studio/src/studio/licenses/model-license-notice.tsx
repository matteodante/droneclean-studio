import { useTranslation } from "react-i18next";

/**
 * Licence lines shown before a downloaded model is used: its weights are not ours and their terms bind
 * the user (audit of 19 Nov 2026, `docs/publish-audit.md`).
 */
const MODEL_LICENSE_URLS = {
  musicgen: "https://creativecommons.org/licenses/by-nc/4.0/",
  supertonic: "https://huggingface.co/Supertone/supertonic-3",
} as const;

type LicensedModel = keyof typeof MODEL_LICENSE_URLS;

export function ModelLicenseNotice({ model }: { model: LicensedModel }) {
  const { t } = useTranslation();
  return (
    <p
      className="text-[11px] text-muted-foreground"
      data-testid={`model-license-${model}`}
    >
      {model === "musicgen"
        ? t("editor.aiPanel.musicgenLicense")
        : t("editor.aiPanel.supertonicLicense")}{" "}
      <a
        href={MODEL_LICENSE_URLS[model]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        {t("editor.aiPanel.modelLicenseLink")}
      </a>
    </p>
  );
}
