/**
 * Tripletex TypeScript Types
 *
 * Basert på Tripletex API dokumentasjon
 *
 * VIKTIG: Beløp er i KRONER (ikke øre som Fiken)
 */

// TODO: Utvid med flere typer i Fase 4

// ==================== COMMON ====================

export interface TripletexAddress {
  id?: number;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: { id: number };
}

export interface TripletexListResponse<T> {
  fullResultSize: number;
  from: number;
  count: number;
  versionDigest?: string;
  values: T[];
}

export interface TripletexSingleResponse<T> {
  value: T;
}

// ==================== COMPANY ====================

export interface TripletexCompany {
  id: number;
  name: string;
  organizationNumber?: string;
  phoneNumber?: string;
  email?: string;
  address?: TripletexAddress;
  // Mange flere felt...
}

// ==================== CUSTOMER ====================

export interface TripletexCustomer {
  id: number;
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  postalAddress?: TripletexAddress;
  physicalAddress?: TripletexAddress;
  deliveryAddress?: TripletexAddress;
  invoiceEmail?: string;
  invoiceSendMethod?: "EMAIL" | "EHF" | "EFAKTURA" | "PAPER" | "MANUAL";
  isPrivateIndividual?: boolean;
  isSupplier?: boolean;
  isCustomer?: boolean;
  singleCustomerInvoice?: boolean;
  accountManager?: { id: number };
  category1?: { id: number };
  category2?: { id: number };
  category3?: { id: number };
}

export interface TripletexCustomerCreate {
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  postalAddress?: Omit<TripletexAddress, "id">;
  invoiceEmail?: string;
  invoiceSendMethod?: "EMAIL" | "EHF" | "EFAKTURA" | "PAPER" | "MANUAL";
  isPrivateIndividual?: boolean;
}

// ==================== SUPPLIER ====================

export interface TripletexSupplier {
  id: number;
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  bankAccounts?: TripletexSupplierBankAccount[];
  postalAddress?: TripletexAddress;
  physicalAddress?: TripletexAddress;
  isSupplier?: boolean;
  isCustomer?: boolean;
  accountManager?: { id: number };
  category1?: { id: number };
  category2?: { id: number };
  category3?: { id: number };
}

export interface TripletexSupplierBankAccount {
  id?: number;
  accountNumber: string;
  iban?: string;
  swift?: string;
  bankName?: string;
}

export interface TripletexSupplierCreate {
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  bankAccounts?: Omit<TripletexSupplierBankAccount, "id">[];
  postalAddress?: Omit<TripletexAddress, "id">;
}

// ==================== PRODUCT ====================

export interface TripletexProduct {
  id: number;
  name: string;
  number?: string;
  description?: string;
  priceExcludingVatCurrency?: number;
  priceIncludingVatCurrency?: number;
  costExcludingVatCurrency?: number;
  isInactive?: boolean;
  productUnit?: { id: number };
  vatType?: { id: number };
  account?: { id: number };
  department?: { id: number };
  supplier?: { id: number };
}

export interface TripletexProductCreate {
  name: string;
  number?: string;
  description?: string;
  priceExcludingVatCurrency?: number;
  priceIncludingVatCurrency?: number;
  vatType?: { id: number };
  account?: { id: number };
}

// ==================== ORDER ====================

export interface TripletexOrder {
  id: number;
  number?: string;
  customer: { id: number };
  receiver?: string;
  orderDate: string;
  deliveryDate?: string;
  deliveryComment?: string;
  deliveryAddress?: TripletexAddress;
  orderLines: TripletexOrderLine[];
  isPrioritizeAmountsIncludingVat: boolean;
  isClosed?: boolean;
  isSubscription?: boolean;
  project?: { id: number };
  department?: { id: number };
}

export interface TripletexOrderLine {
  id?: number;
  order?: { id: number };
  product?: { id: number };
  description: string;
  count: number;
  unitPriceExcludingVatCurrency?: number;
  unitPriceIncludingVatCurrency?: number;
  vatType: { id: number };
  discount?: number;
  amountExcludingVatCurrency?: number;
  amountIncludingVatCurrency?: number;
}

export interface TripletexOrderCreate {
  customer: { id: number };
  receiver?: string;
  orderDate: string;
  deliveryDate?: string;
  deliveryAddress?: Omit<TripletexAddress, "id">;
  orderLines: Omit<TripletexOrderLine, "id" | "order">[];
  isPrioritizeAmountsIncludingVat: boolean;
  project?: { id: number };
  department?: { id: number };
}

// ==================== INVOICE ====================

export interface TripletexInvoice {
  id: number;
  invoiceNumber?: number;
  customer: { id: number };
  invoiceDate: string;
  invoiceDueDate: string;
  orders?: { id: number }[];
  comment?: string;
  isCreditNote?: boolean;
  amountExcludingVat?: number;
  amountIncludingVat?: number;
  amountOutstanding?: number;
  ehfSendStatus?: "DO_NOT_SEND" | "SEND" | "SENT" | "SEND_FAILURE_RECIPIENT_NOT_FOUND";
}

// ==================== SUPPLIER INVOICE ====================

export interface TripletexSupplierInvoice {
  id: number;
  invoiceNumber?: string;
  supplier: { id: number };
  invoiceDate: string;
  dueDate: string;
  paymentTypeId?: number;
  amount?: number;
  amountCurrency?: number;
  amountExcludingVat?: number;
  amountExcludingVatCurrency?: number;
  currency?: { id: number };
  isCreditNote?: boolean;
  orderLines?: TripletexSupplierInvoiceLine[];
  approvalStatus?: "NOT_APPROVED" | "APPROVED" | "REJECTED";
}

export interface TripletexSupplierInvoiceLine {
  id?: number;
  supplierInvoice?: { id: number };
  account?: { id: number };
  description: string;
  amountExcludingVatCurrency: number;
  vatType: { id: number };
  project?: { id: number };
  department?: { id: number };
}

export interface TripletexSupplierInvoiceCreate {
  invoiceNumber?: string;
  supplier: { id: number };
  invoiceDate: string;
  dueDate: string;
  paymentTypeId?: number;
  orderLines: Omit<TripletexSupplierInvoiceLine, "id" | "supplierInvoice">[];
}

// ==================== VOUCHER ====================

export interface TripletexVoucher {
  id: number;
  date: string;
  number?: number;
  description: string;
  postings: TripletexPosting[];
  document?: { id: number };
}

export interface TripletexPosting {
  id?: number;
  voucher?: { id: number };
  date: string;
  description?: string;
  account: { id: number };
  amountGross: number;
  amountGrossCurrency: number;
  customer?: { id: number };
  supplier?: { id: number };
  project?: { id: number };
  department?: { id: number };
}

export interface TripletexVoucherCreate {
  date: string;
  description: string;
  postings: Omit<TripletexPosting, "id" | "voucher">[];
}

// ==================== ACCOUNT ====================

export interface TripletexAccount {
  id: number;
  number: number;
  name: string;
  description?: string;
  type?: "ASSETS" | "EQUITY" | "LIABILITIES" | "OPERATING_REVENUES" | "OPERATING_EXPENSES" | "INVESTMENT_INCOME" | "COST_OF_CAPITAL" | "TAX_ON_ORDINARY_ACTIVITIES" | "EXTRAORDINARY_INCOME" | "EXTRAORDINARY_COST" | "TAX_ON_EXTRAORDINARY_ACTIVITIES" | "ANNUAL_RESULT" | "TRANSFERS_AND_ALLOCATIONS";
  vatType?: { id: number };
  isBankAccount?: boolean;
  isInactive?: boolean;
  isApplicableForSupplierInvoice?: boolean;
  requireReconciliation?: boolean;
}

// ==================== VAT TYPE ====================

export interface TripletexVatType {
  id: number;
  name: string;
  number: string;
  displayName?: string;
  percentage: number;
}

// Vanlige MVA-koder i Tripletex:
// 1  = Inngående MVA 25%
// 11 = Inngående MVA 15%
// 12 = Inngående MVA 12% (mat)
// 13 = Inngående MVA 11.11%
// 3  = Utgående MVA 25%
// 31 = Utgående MVA 15%
// 32 = Utgående MVA 12% (mat)
// 33 = Utgående MVA 11.11%
// 5  = MVA-fri
// 6  = Utenfor MVA-loven
// 7  = Ingen MVA-behandling

// ==================== PROJECT ====================

export interface TripletexProject {
  id: number;
  name: string;
  number?: string;
  description?: string;
  projectManager?: { id: number };
  department?: { id: number };
  mainProject?: { id: number };
  startDate?: string;
  endDate?: string;
  customer?: { id: number };
  isClosed?: boolean;
  isInternal?: boolean;
}

export interface TripletexProjectCreate {
  name: string;
  number?: string;
  description?: string;
  projectManager?: { id: number };
  department?: { id: number };
  startDate?: string;
  endDate?: string;
  customer?: { id: number };
}

// ==================== DEPARTMENT ====================

export interface TripletexDepartment {
  id: number;
  name: string;
  number?: string;
  departmentManager?: { id: number };
  isInactive?: boolean;
}

export interface TripletexDepartmentCreate {
  name: string;
  number?: string;
  departmentManager?: { id: number };
}

// ==================== EMPLOYEE ====================

export interface TripletexEmployee {
  id: number;
  firstName: string;
  lastName: string;
  employeeNumber?: string;
  email?: string;
  phoneNumberMobile?: string;
  phoneNumberHome?: string;
  phoneNumberWork?: string;
  nationalIdentityNumber?: string;
  dateOfBirth?: string;
  address?: TripletexAddress;
  department?: { id: number };
  employments?: TripletexEmployment[];
}

export interface TripletexEmployment {
  id: number;
  startDate: string;
  endDate?: string;
  percentageOfFullTimeEquivalent?: number;
  employmentType?: "ORDINARY" | "MARITIME" | "FREELANCE";
}

export interface TripletexEmployeeCreate {
  firstName: string;
  lastName: string;
  employeeNumber?: string;
  email?: string;
  phoneNumberMobile?: string;
  dateOfBirth?: string;
  address?: Omit<TripletexAddress, "id">;
  department?: { id: number };
}

// ==================== BANK ====================

export interface TripletexBankAccount {
  id: number;
  accountNumber: string;
  iban?: string;
  name?: string;
  bankName?: string;
  bankAccountType?: string;
}

export interface TripletexBankStatement {
  id: number;
  bankAccount: { id: number };
  fileName?: string;
  openingBalance?: number;
  closedBalance?: number;
  transactions?: TripletexBankTransaction[];
}

export interface TripletexBankTransaction {
  id: number;
  bankStatement?: { id: number };
  date: string;
  amount: number;
  description?: string;
}

// ==================== SALARY ====================

export interface TripletexSalaryType {
  id: number;
  number?: string;
  name?: string;
  description?: string;
  showInTimesheet?: boolean;
  isSickPayable?: boolean;
  isVacationPayable?: boolean;
  isTaxable?: boolean;
  isPayrollTaxable?: boolean;
}

export interface TripletexSalaryTransaction {
  id?: number;
  date?: string;
  year: number;
  month: number;
  isHistorical?: boolean;
  paySlipsAvailableDate?: string;
  payslips?: TripletexPayslip[];
}

export interface TripletexPayslip {
  id: number;
  transaction?: { id: number };
  employee?: { id: number; firstName?: string; lastName?: string };
  date?: string;
  year?: number;
  month?: number;
  specifications?: TripletexSalarySpecification[];
  vacationAllowanceAmount?: number;
  grossAmount?: number;
  amount?: number;
  number?: number;
}

export interface TripletexSalarySpecification {
  id?: number;
  rate?: number;
  count?: number;
  salaryType?: { id: number; name?: string };
  employee?: { id: number };
  description?: string;
  year?: number;
  month?: number;
  amount?: number;
}

// ==================== EMPLOYMENT (utvidet for lønn) ====================

export interface TripletexEmploymentFull {
  id: number;
  employee?: { id: number };
  employmentId?: string;
  startDate: string;
  endDate?: string;
  employmentEndReason?:
    | "EMPLOYMENT_END_EXPIRED"
    | "EMPLOYMENT_END_EMPLOYEE"
    | "EMPLOYMENT_END_EMPLOYER"
    | "EMPLOYMENT_END_WRONGLY_REPORTED"
    | "EMPLOYMENT_END_SYSTEM_OR_ACCOUNTANT_CHANGE"
    | "EMPLOYMENT_END_INTERNAL_CHANGE";
  division?: { id: number; name?: string };
  lastSalaryChangeDate?: string;
  noEmploymentRelationship?: boolean;
  isMainEmployer?: boolean;
  taxDeductionCode?:
    | "loennFraHovedarbeidsgiver"
    | "loennFraBiarbeidsgiver"
    | "pensjon"
    | string;
  employmentDetails?: TripletexEmploymentDetails[];
}

export interface TripletexEmploymentDetails {
  id?: number;
  employment?: { id: number };
  date?: string;
  employmentType?: "ORDINARY" | "MARITIME" | "FREELANCE" | "NOT_CHOSEN";
  employmentForm?:
    | "PERMANENT"
    | "TEMPORARY"
    | "PERMANENT_AND_HIRED_OUT"
    | "TEMPORARY_AND_HIRED_OUT"
    | "TEMPORARY_ON_CALL"
    | "NOT_CHOSEN";
  remunerationType?:
    | "MONTHLY_WAGE"
    | "HOURLY_WAGE"
    | "COMMISION_PERCENTAGE"
    | "FEE"
    | "NOT_CHOSEN"
    | "PIECEWORK_WAGE";
  workingHoursScheme?:
    | "NOT_SHIFT"
    | "ROUND_THE_CLOCK"
    | "SHIFT_365"
    | "OFFSHORE_336"
    | "CONTINUOUS"
    | "OTHER_SHIFT"
    | "NOT_CHOSEN";
  percentageOfFullTimeEquivalent?: number;
  annualSalary?: number;
  hourlyWage?: number;
  monthlySalary?: number; // read-only
  occupationCode?: { id: number; code?: string; nameNO?: string };
}

export interface TripletexEmploymentCreate {
  employee: { id: number };
  division: { id: number };
  startDate: string;
  endDate?: string;
  isMainEmployer?: boolean;
  taxDeductionCode?: string;
  employmentDetails?: Omit<TripletexEmploymentDetails, "id" | "employment">[];
}

// ==================== DIVISION ====================

export interface TripletexDivision {
  id: number;
  name?: string;
  displayName?: string;
  startDate?: string;
  endDate?: string;
  organizationNumber?: string;
  municipality?: { id: number; name?: string; number?: string };
}

// ==================== DOCUMENT ====================

export interface TripletexDocument {
  id: number;
  fileName: string;
  downloadUrl?: string;
}
