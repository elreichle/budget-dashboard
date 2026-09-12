/**
 * Invented exports, one per shape the parser must read. Kept as strings because `*.csv` is
 * gitignored (a real export must never be committed by accident). Merchants and amounts are made up.
 */

/** One signed column, charges negative, transaction date before posted date. */
export const SIGNED_CARD = `Transaction Date,Posted Date,Description,Amount
09/03/2026,09/04/2026,COFFEE HOUSE,-4.50
09/02/2026,09/03/2026,"GROCERY MART, INC",-82.13
09/01/2026,09/01/2026,PAYMENT THANK YOU,250.00
`;

/** Every row ends with a trailing comma the header does not have. */
export const TRAILING_COMMA = `Date,Description,Amount,Balance
09/03/2026,COFFEE HOUSE,-4.50,1495.50,
09/01/2026,PAYROLL DEPOSIT,1500.00,1500.00,
`;

/** Unsigned money-out and money-in columns, with a status column marking pending rows. */
export const SPLIT_WITH_STATUS = `Date,Description,Debit,Credit,Status
09/06/2026,STREAMING SERVICE,12.99,,Pending
09/04/2026,HARDWARE STORE,37.20,,Cleared
09/02/2026,PAYMENT RECEIVED,,150.00,Cleared
`;

/** One signed column with charges listed positive and payments negative. */
export const POSITIVE_CHARGES = `Date,Description,Amount
09/05/2026,BUS FARE 12,41.00
09/03/2026,CARD PAYMENT - THANK YOU,-200.00
`;

/** ISO dates, one signed column and a status column. */
export const SIGNED_WITH_STATUS = `Date,Description,Type,Amount,Balance,Status
2026-09-05,PAYROLL DEPOSIT,Deposit,1500.00,2350.00,Posted
2026-09-06,RENT PAYMENT,Withdrawal,-1200.00,1150.00,Posted
2026-09-07,PHARMACY,Debit Card,-18.75,1131.25,Pending
`;

export const GENERIC = `Date,Description,Amount
2026-09-01,Garden Center,-22.00
2026-09-01,Garden Center,-22.00
2026-09-02,Refund from garden center,22.00
`;

/** Quirks a reader must survive: BOM, CRLF, lower-case headers, quoted commas and quotes. */
export const MESSY_GENERIC = `\uFEFFdate,description,amount\r\n2026-09-01,"BAKERY ""THE LOAF"", DOWNTOWN","$1,234.56"\r\n2026-09-02,Parking,(3.00)\r\n\r\n`;

export const GENERIC_WITH_BAD_ROWS = `Date,Description,Amount
2026-09-01,Garden Center,-22.00
not a date,Garden Center,-22.00
2026-09-03,Garden Center,twenty
2026-09-04,Extra column,-1.00,oops
`;
