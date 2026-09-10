/** Content blocks that compose a bulletproof HTML email body. */
export type EmailBlock =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; text: string; muted?: boolean; align?: "left" | "center" | "right" }
  | { type: "html"; /** Pre-sanitised, trusted HTML. Never pass user input here. */ trustedHtml: string }
  | { type: "button"; text: string; url: string }
  | { type: "image"; src: string; alt: string; width?: number; href?: string }
  | { type: "divider" }
  | { type: "spacer"; height?: number }
  | { type: "callout"; text: string };

export interface EmailTheme {
  /** Primary/brand color used for buttons and links. */
  brandColor: string;
  /** Page background behind the content card. */
  backgroundColor: string;
  /** Card (content) background. */
  cardColor: string;
  /** Body text color. */
  textColor: string;
  /** Muted/secondary text color. */
  mutedColor: string;
  /** Button label color. */
  buttonTextColor: string;
  fontFamily: string;
  /** Content width in px. */
  width: number;
  borderRadius: number;
}

export interface BrandHeader {
  /** Logo image URL. When omitted, `name` is rendered as text. */
  logoUrl?: string;
  logoWidth?: number;
  name: string;
  href?: string;
}

export interface EmailFooter {
  /** Lines of small print (e.g. company name). Escaped as plain text. */
  lines?: string[];
  /** Physical mailing address — required by CAN-SPAM for bulk mail. */
  address?: string;
  unsubscribeUrl?: string;
  unsubscribeText?: string;
}

export interface BulletproofEmailInput {
  /** Short preview text shown in the inbox list, hidden in the body. */
  preheader?: string;
  header?: BrandHeader;
  blocks: EmailBlock[];
  footer?: EmailFooter;
  theme?: Partial<EmailTheme>;
  /** Document language for the `lang` attribute. Default "en". */
  lang?: string;
  dir?: "ltr" | "rtl";
  title?: string;
}

export interface RenderedEmail {
  html: string;
  /** Auto-generated plaintext alternative. */
  text: string;
}

export const DEFAULT_THEME: EmailTheme = {
  brandColor: "#2563eb",
  backgroundColor: "#f4f4f7",
  cardColor: "#ffffff",
  textColor: "#333333",
  mutedColor: "#6b7280",
  buttonTextColor: "#ffffff",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",
  width: 600,
  borderRadius: 8,
};
