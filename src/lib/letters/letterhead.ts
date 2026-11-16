// The Society's letterhead, copied from the library samples (Roll-over and Top-up membership agreement letters and the
// Membership loan application letter). Change these when an office moves or a number changes.

export const SOCIETY = {
  name: "SilverKuun",
  legalName: "Cooperative Society Ltd.",
  /** How the letters sign off and name the lender. */
  signOff: "SILVER KUUN LTD",
  lender: "Silverkuun Cooperative Society Ltd",
  rcNumber: "1445982",
  phones: ["0803 794 2635", "0818 959 3567", "0701 160 5990"],
  email: "info@silverkuunloans.com",
  social: "@silverkuun",
  website: "www.silverkuunloans.com",
  banks: "Access Bank, Eco- Bank and Zenith Bank",
  /** Notice the Society needs before a member liquidates, in weeks. */
  liquidationNoticeWeeks: 12,
  /** What liquidating before maturity costs, as a share of the deposit. */
  earlyLiquidationCharge: "50%",
} as const;

export const OFFICES: { title: string; lines: string[] }[] = [
  {
    title: "Abuja Office",
    lines: [
      "Suite 101 & 102, Shashilga Court, Plot 102, Ahmadu Bello Way, Mabushi, Abuja",
      "Suite 1 & 2 Favour Plaza, By Gado Nasko Road, Kubwa, Abuja",
      "Suite 7 and 8, Atlantic Mall, Ajose Adeogun Street, Utako, Abuja",
    ],
  },
  {
    title: "Lagos Office",
    lines: [
      "48, Raymond Njoku Street, Ikoyi, South West, Lagos - Nigeria.",
      "362, 3rd Floor Right Wing, Herbert Macaulay Way, Yaba Lagos",
      "Festac Area 4th Avenue, F Close Opposite Mobile Filling Station, Lagos.",
      "EAN Jet Center International Airport, Ikeja, Lagos.",
    ],
  },
  {
    title: "Port-Harcourt Office",
    lines: [
      "Suite 1, Emykodos Plaza, Plot 6 Odili Road Beside Market Square Supermarket",
      "F.H. Jumbo House No 80 Aba Road, (Opposite Govt Crafts School) (First Floor, Right Wing) Port Harcourt.",
    ],
  },
];
