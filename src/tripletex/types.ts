/**
 * Tripletex API Types
 * Based on Tripletex API v2 documentation
 * 
 * Focus areas: Payroll (lønn), A-melding, Vouchers (bilag), Invoices, Customers, Suppliers
 */

// ==================== COMMON TYPES ====================

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

// ==================== EMPLOYEE ====================

export interface Employee {
  id: number;
  version?: number;
  firstName: string;
  lastName: string;
  displayName?: string;
  email?: string;
  phoneNumberMobileCountry?: Country;
  phoneNumberMobile?: string;
  phoneNumberHome?: string;
  phoneNumberWork?: string;
  nationalIdentityNumber?: string; // Personnummer (11 siffer)
  dnNumber?: string; // D-nummer for utenlandske
  internationalId?: InternationalId;
  bankAccountNumber?: string;
  iban?: string;
  bic?: string;
  creditorBankCountryId?: number;
  employeeNumber?: string;
  dateOfBirth?: string;
  address?: Address;
  department?: Department;
  employments?: Employment[];
  holidayAllowanceEarned?: TripletexHolidayAllowance;
  isDefaultRemunerationType?: boolean; // Naturalytelser
}

export interface InternationalId {
  intAmeldingType?: "PASSPORT_NO" | "NATIONAL_INSURANCE_NO" | "TAX_IDENTIFICATION_NO" | "VALUE_ADDED_TAX_IDENTIFICATION_NO";
  country?: Country;
  number?: string;
}

export interface Country {
  id: number;
  version?: number;
  name?: string;
}

export interface Address {
  id?: number;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: Country;
}

export interface Department {
  id: number;
  version?: number;
  name?: string;
  departmentNumber?: string;
}

export interface TripletexHolidayAllowance {
  year?: number;
  amount?: number;
  basis?: number;
  amountExtraHolidayWeek?: number;
}

// ==================== EMPLOYMENT ====================

export interface Employment {
  id: number;
  version?: number;
  employee?: Employee;
  employmentId?: string; // Arbeidsforholds-ID for A-melding
  startDate: string;
  endDate?: string;
  employmentEndReason?: "EXPIRED" | "RESIGNED" | "TERMINATED_BY_EMPLOYER" | "TRANSFER" | "OTHER";
  division?: Division;
  lastSalaryChangeDate?: string;
  noEmploymentRelationship?: boolean;
  isMainEmployer?: boolean;
  taxDeductionCode?: "loennFraHoved662" | "loennFraBi662" | "loennFraHovedFraSjoefolk" | "loennFraBiFraSjoefolk" | "loennKunTrygdeavgift" | "loennKunTrygdeavgiftFraSjoefolk" | "ufoeretrygd" | "ufoeretrygdEtterloenn" | "pensjon" | "pensjonFraSjoefolk" | "introduksjonsstoenad";
  employmentDetails?: EmploymentDetails[];
}

export interface Division {
  id: number;
  version?: number;
  name?: string;
  organizationNumber?: string;
  municipality?: Municipality;
}

export interface Municipality {
  id: number;
  version?: number;
  name?: string;
  municipalityNo?: string; // Kommunenummer
}

export interface EmploymentDetails {
  id: number;
  version?: number;
  employment?: Employment;
  date: string;
  employmentType?: "ORDINARY" | "MARITIME" | "FREELANCE";
  employmentForm?: "PERMANENT" | "TEMPORARY";
  maritimeEmployment?: MaritimeEmployment;
  remunerationType?: "MONTHLY_WAGE" | "HOURLY_WAGE" | "COMMISSION_PERCENTAGE" | "FEE" | "PIECEWORK_WAGE";
  workingHoursScheme?: "NOT_SHIFT" | "ROUND_THE_CLOCK" | "SHIFT_365" | "OFFSHORE_336" | "CONTINUOUS" | "OTHER_SHIFT";
  shiftDurationHours?: number;
  occupationCode?: OccupationCode;
  percentageOfFullTimeEquivalent?: number; // Stillingsprosent
  annualSalary?: number;
  hourlyWage?: number;
  payrollTaxMunicipalityId?: Municipality;
}

export interface MaritimeEmployment {
  shipRegister?: "NIS" | "NOR" | "FOREIGN";
  shipType?: "OTHER" | "TOURIST" | "DRILLING_RIG" | "CARGO" | "PASSENGER_FERRY" | "OFFSHORE_SUPPLY_VESSEL" | "FISHING";
  tradeArea?: "DOMESTIC" | "FOREIGN";
}

export interface OccupationCode {
  id: number;
  version?: number;
  nameNO?: string;
  code?: string;
}

// ==================== SALARY / PAYROLL ====================

export interface SalaryType {
  id: number;
  version?: number;
  number?: string;
  name?: string;
  description?: string;
  showInTimesheet?: boolean;
  isInactive?: boolean;
  ameldingWageCode?: number; // A-melding lønnsbeskrivelse-kode
  ameldingWageCodeDescription?: string;
}

export interface Payslip {
  id: number;
  version?: number;
  employee?: Employee;
  date?: string;
  year?: number;
  month?: number;
  specifications?: PayslipSpecification[];
  vacationAllowanceAmount?: number;
  grossAmount?: number;
  amount?: number; // Netto utbetalt
  travelExpenses?: Expense;
  expenseReimbursements?: Expense;
  payrollTaxAmount?: number; // Arbeidsgiveravgift
  payrollTaxBasis?: number;
  payrollTaxMunicipalityId?: Municipality;
  taxDeductionAmount?: number; // Skattetrekk
  advanceAmount?: number;
}

export interface PayslipSpecification {
  id: number;
  version?: number;
  payslip?: Payslip;
  salaryType?: SalaryType;
  rate?: number;
  count?: number;
  amount?: number;
  description?: string;
}

export interface Expense {
  id: number;
  version?: number;
  total?: number;
}

export interface SalaryTransaction {
  id: number;
  version?: number;
  date?: string;
  year?: number;
  month?: number;
  isHistorical?: boolean;
  payrollTaxCalcMethod?: "AA_BASE" | "FIXED_PERCENTAGE";
  voucherComment?: string;
  payslips?: Payslip[];
  attachment?: Document;
  payrollTaxAmount?: number;
  hasAutoPayPayslips?: boolean;
  paymentDate?: string;
}

export interface Document {
  id: number;
  version?: number;
  fileName?: string;
}

export interface SalaryCompilation {
  employees?: SalaryCompilationLine[];
  total?: number;
  taxDeductions?: number;
  payrollTax?: number;
  netPaid?: number;
}

export interface SalaryCompilationLine {
  employee?: Employee;
  grossSalary?: number;
  taxDeduction?: number;
  netPaid?: number;
  payrollTax?: number;
}

export interface SalarySettings {
  id: number;
  version?: number;
  payrollTaxCalcMethod?: "AA_BASE" | "FIXED_PERCENTAGE";
  showSocialSecurityNumberInPdfs?: boolean;
}

// ==================== A-MELDING / RECONCILIATION ====================

export interface ReconciliationContext {
  id: number;
  version?: number;
  year?: number;
  month?: number;
  isDone?: boolean;
}

export interface TaxDeductionReconciliationOverview {
  totalPayments?: number;
  taxDeductionBalance?: number;
  taxDeductionBalancePerSalaryTransaction?: TaxDeductionBalancePerTransaction[];
}

export interface TaxDeductionBalancePerTransaction {
  salaryTransaction?: SalaryTransaction;
  taxDeduction?: number;
  balance?: number;
}

export interface PayrollTaxReconciliationOverview {
  totalPayments?: number;
  payrollTaxBalance?: number;
  payrollTaxBalancePerDivision?: PayrollTaxBalancePerDivision[];
}

export interface PayrollTaxBalancePerDivision {
  division?: Division;
  payrollTax?: number;
  balance?: number;
}

// ==================== API REQUEST/RESPONSE WRAPPERS ====================

export interface GetEmployeesParams {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  employeeNumber?: string;
  allowInformationRegistration?: boolean;
  includeContacts?: boolean;
  departmentId?: string;
  onlyProjectManagers?: boolean;
  assignableProjectManagers?: boolean;
  periodStart?: string;
  periodEnd?: string;
  hasSystemAccess?: boolean;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetPayslipsParams {
  id?: string;
  employeeId?: string;
  yearFrom?: number;
  yearTo?: number;
  monthFrom?: number;
  monthTo?: number;
  voucherId?: string;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetSalaryTransactionsParams {
  id?: string;
  employeeId?: string;
  yearFrom?: number;
  yearTo?: number;
  monthFrom?: number;
  monthTo?: number;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface CreateSalaryTransactionInput {
  date: string;
  year: number;
  month: number;
  payslips?: CreatePayslipInput[];
  isHistorical?: boolean;
  paySlipsAvailableDate?: string;
}

export interface CreatePayslipInput {
  employee: { id: number };
  specifications?: CreatePayslipSpecificationInput[];
}

export interface CreatePayslipSpecificationInput {
  salaryType: { id: number };
  rate?: number;
  count?: number;
  amount?: number;
  description?: string;
  year?: number;
  month?: number;
}

// ==================== EMPLOYEE CRUD ====================

export interface CreateEmployeeInput {
  firstName: string;
  lastName: string;
  email?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  nationalIdentityNumber?: string; // 11 digits
  dnumber?: string; // D-nummer for foreigners
  employeeNumber?: string;
  bankAccountNumber?: string;
  phoneNumberMobile?: string;
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    postalCode?: string;
    city?: string;
  };
  department?: { id: number };
}

export interface UpdateEmployeeInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  dateOfBirth?: string;
  employeeNumber?: string;
  bankAccountNumber?: string;
  phoneNumberMobile?: string;
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    postalCode?: string;
    city?: string;
  };
  department?: { id: number };
}

// ==================== EMPLOYMENT CRUD ====================

export interface CreateEmploymentInput {
  employee: { id: number };
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  division?: { id: number };
  employmentDetails?: CreateEmploymentDetailsInput[];
}

export interface CreateEmploymentDetailsInput {
  date: string; // YYYY-MM-DD
  employmentType?: "ORDINARY" | "MARITIME" | "FREELANCE";
  employmentForm?: "PERMANENT" | "TEMPORARY";
  remunerationType?: "MONTHLY_WAGE" | "HOURLY_WAGE" | "COMMISSION_PERCENTAGE" | "FEE" | "PIECEWORK_WAGE";
  percentageOfFullTimeEquivalent?: number; // 0-100
  annualSalary?: number;
  hourlyWage?: number;
  occupationCode?: { id: number };
}

export interface UpdateEmploymentInput {
  startDate?: string;
  endDate?: string;
  division?: { id: number };
}

// ==================== ACCOUNT (Kontoplan) ====================

export interface Account {
  id: number;
  version?: number;
  number?: number;
  name?: string;
  description?: string;
  type?: "ASSETS" | "EQUITY" | "LIABILITIES" | "OPERATING_REVENUES" | "OPERATING_EXPENSES" | "INVESTMENT_PROFIT" | "COST_OF_CAPITAL" | "TAX_ON_ORDINARY_ACTIVITIES" | "EXTRAORDINARY_INCOME" | "EXTRAORDINARY_COST" | "TAX_ON_EXTRAORDINARY_ACTIVITIES" | "ANNUAL_RESULT" | "TRANSFERS_AND_டALLOCATIONS";
  vatType?: VatType;
  vatLocked?: boolean;
  currency?: Currency;
  isCloseable?: boolean;
  isApplicableForSupplierInvoice?: boolean;
  requireReconciliation?: boolean;
  isInactive?: boolean;
  isBankAccount?: boolean;
  isInvoiceAccount?: boolean;
  bankAccountNumber?: string;
  bankAccountCountry?: Country;
  bankName?: string;
  bankAccountIBAN?: string;
  bankAccountSWIFT?: string;
}

export interface VatType {
  id: number;
  version?: number;
  name?: string;
  number?: string;
  percentage?: number;
  description?: string;
}

export interface Currency {
  id?: number;
  code?: string;
  description?: string;
  factor?: number;
}

// ==================== VOUCHER (Bilag) ====================

export interface Voucher {
  id: number;
  version?: number;
  date?: string;
  number?: number;
  tempNumber?: number;
  year?: number;
  description?: string;
  voucherType?: VoucherType;
  reverseVoucher?: Voucher;
  postings?: Posting[];
  document?: TripletexDocument;
  attachment?: TripletexDocument;
  ediDocument?: TripletexDocument;
}

export interface VoucherType {
  id: number;
  version?: number;
  name?: string;
}

export interface Posting {
  id: number;
  version?: number;
  voucher?: Voucher;
  date?: string;
  description?: string;
  account?: Account;
  customer?: Customer;
  supplier?: Supplier;
  employee?: Employee;
  project?: Project;
  product?: Product;
  department?: Department;
  vatType?: VatType;
  amount?: number;
  amountCurrency?: number;
  amountGross?: number;
  amountGrossCurrency?: number;
  currency?: Currency;
  closeGroup?: CloseGroup;
  invoiceNumber?: string;
  termOfPayment?: string;
  row?: number;
  type?: "INCOMING_PAYMENT" | "INCOMING_PAYMENT_OPPOSITE" | "PAYMENT" | "PAYMENT_OPPOSITE" | "CUSTOMER_OPENING_BALANCE" | "SUPPLIER_OPENING_BALANCE" | "SUM" | "DEFAULT";
  systemGenerated?: boolean;
}

export interface CloseGroup {
  id: number;
  version?: number;
  date?: string;
  postings?: Posting[];
}

export interface TripletexDocument {
  id: number;
  version?: number;
  fileName?: string;
  size?: number;
  mimeType?: string;
}

export interface Project {
  id: number;
  version?: number;
  name?: string;
  number?: string;
  displayName?: string;
  description?: string;
  projectManager?: Employee;
  department?: Department;
  mainProject?: Project;
  startDate?: string;
  endDate?: string;
  customer?: Customer;
  isClosed?: boolean;
  isReady?: boolean;
  isInternal?: boolean;
  isOffer?: boolean;
  currency?: Currency;
}

// ==================== CUSTOMER ====================

export interface Customer {
  id: number;
  version?: number;
  name: string;
  organizationNumber?: string;
  supplierNumber?: number;
  customerNumber?: number;
  isSupplier?: boolean;
  isCustomer?: boolean;
  isInactive?: boolean;
  accountManager?: Employee;
  email?: string;
  invoiceEmail?: string;
  overdueNoticeEmail?: string;
  bankAccounts?: string[];
  phoneNumber?: string;
  phoneNumberMobile?: string;
  description?: string;
  language?: "NO" | "EN" | "SV";
  displayName?: string;
  isPrivateIndividual?: boolean;
  singleCustomerInvoice?: boolean;
  invoiceSendMethod?: "EMAIL" | "EHF" | "EFAKTURA" | "AVTALEGIRO" | "VIPPS" | "PAPER" | "MANUAL";
  emailAttachmentType?: "LINK" | "ATTACHMENT";
  postalAddress?: Address;
  physicalAddress?: Address;
  deliveryAddress?: DeliveryAddress;
  category1?: CustomerCategory;
  category2?: CustomerCategory;
  category3?: CustomerCategory;
}

export interface CustomerCategory {
  id: number;
  version?: number;
  name?: string;
  number?: string;
  type?: number;
}

export interface DeliveryAddress {
  id?: number;
  version?: number;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: Country;
  employee?: Employee;
  name?: string;
}

// ==================== SUPPLIER (Leverandør) ====================

export interface Supplier {
  id: number;
  version?: number;
  name: string;
  organizationNumber?: string;
  supplierNumber?: number;
  customerNumber?: number;
  isSupplier?: boolean;
  isCustomer?: boolean;
  isInactive?: boolean;
  email?: string;
  bankAccounts?: string[];
  invoiceEmail?: string;
  overdueNoticeEmail?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  description?: string;
  isPrivateIndividual?: boolean;
  showProducts?: boolean;
  accountManager?: Employee;
  postalAddress?: Address;
  physicalAddress?: Address;
  deliveryAddress?: DeliveryAddress;
  category1?: CustomerCategory;
  category2?: CustomerCategory;
  category3?: CustomerCategory;
}

// ==================== INVOICE (Utgående faktura) ====================

export interface Invoice {
  id: number;
  version?: number;
  invoiceNumber?: number;
  invoiceDate?: string;
  invoiceDueDate?: string;
  kid?: string;
  comment?: string;
  orders?: Order[];
  orderLines?: OrderLine[];
  travelReports?: TravelReport[];
  projectInvoiceDetails?: ProjectInvoiceDetails[];
  voucher?: Voucher;
  deliveryDate?: string;
  amount?: number;
  amountCurrency?: number;
  amountExcludingVat?: number;
  amountExcludingVatCurrency?: number;
  amountRoundoff?: number;
  amountRoundoffCurrency?: number;
  amountOutstanding?: number;
  amountOutstandingTotal?: number;
  amountOutstandingCurrency?: number;
  sumRemits?: number;
  currency?: Currency;
  isCreditNote?: boolean;
  isCharged?: boolean;
  isApproved?: boolean;
  postings?: Posting[];
  reminders?: Reminder[];
  invoiceRemarks?: string;
  paymentTypeId?: number;
  paidAmount?: number;
  ehfSendStatus?: "DO_NOT_SEND" | "SEND" | "SENT" | "SEND_FAILURE_RECIPIENT_NOT_FOUND";
}

export interface Order {
  id: number;
  version?: number;
  customer?: Customer;
  contact?: Contact;
  attn?: Contact;
  receiverEmail?: string;
  overdueNoticeEmail?: string;
  number?: string;
  reference?: string;
  ourContact?: Contact;
  ourContactEmployee?: Employee;
  department?: Department;
  orderDate?: string;
  project?: Project;
  invoiceComment?: string;
  currency?: Currency;
  invoicesDueIn?: number;
  invoicesDueInType?: "DAYS" | "MONTHS" | "RECURRING_DAY_OF_MONTH";
  isShowOpenPostsOnInvoices?: boolean;
  isClosed?: boolean;
  deliveryDate?: string;
  deliveryAddress?: DeliveryAddress;
  deliveryComment?: string;
  isPrioritizeAmountsIncludingVat?: boolean;
  orderLineSorting?: "ID" | "PRODUCT" | "CUSTOM";
  orderLines?: OrderLine[];
  isSubscription?: boolean;
  subscriptionDuration?: number;
  subscriptionDurationType?: "MONTHS" | "YEAR";
  subscriptionPeriodsOnInvoice?: number;
  subscriptionPeriodsOnInvoiceType?: "MONTHS";
  subscriptionInvoicingTimeInAdvanceOrArrears?: "ADVANCE" | "ARREARS";
  subscriptionInvoicingTime?: number;
  subscriptionInvoicingTimeType?: "DAYS" | "MONTHS";
}

export interface OrderLine {
  id: number;
  version?: number;
  order?: Order;
  product?: Product;
  inventory?: Inventory;
  inventoryLocation?: InventoryLocation;
  description?: string;
  count?: number;
  unitCostPrice?: number;
  unitPriceExcludingVat?: number;
  unitPriceExcludingVatCurrency?: number;
  unitPriceIncludingVat?: number;
  unitPriceIncludingVatCurrency?: number;
  currency?: Currency;
  markup?: number;
  discount?: number;
  vatType?: VatType;
  amountExcludingVat?: number;
  amountExcludingVatCurrency?: number;
  amountIncludingVat?: number;
  amountIncludingVatCurrency?: number;
  isSubscription?: boolean;
  subscriptionPeriodStart?: string;
  subscriptionPeriodEnd?: string;
  orderGroup?: OrderGroup;
}

export interface OrderGroup {
  id: number;
  version?: number;
  order?: Order;
  title?: string;
  comment?: string;
  sortIndex?: number;
}

export interface Contact {
  id: number;
  version?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumberMobileCountry?: Country;
  phoneNumberMobile?: string;
  phoneNumberWork?: string;
  customer?: Customer;
  department?: string;
  title?: string;
}

export interface TravelReport {
  id: number;
  version?: number;
}

export interface ProjectInvoiceDetails {
  id: number;
  version?: number;
  project?: Project;
  feeAmount?: number;
  feeAmountCurrency?: number;
  markupPercent?: number;
  markupAmount?: number;
  markupAmountCurrency?: number;
  amountOrderLinesAndReinvoicing?: number;
  amountOrderLinesAndReinvoicingCurrency?: number;
  amountTravelReportsAndExpenses?: number;
  amountTravelReportsAndExpensesCurrency?: number;
  feeInvoiceText?: string;
  invoiceText?: string;
  includeOrderLinesAndReinvoicing?: boolean;
  includeHours?: boolean;
  includeTravelReports?: boolean;
  includeProjectMarkup?: boolean;
}

export interface Reminder {
  id: number;
  version?: number;
  reminderDate?: string;
  charge?: number;
  chargeCurrency?: number;
  totalCharge?: number;
  totalChargeCurrency?: number;
  totalAmountCurrency?: number;
  interests?: number;
  interestRate?: number;
  termOfPayment?: string;
  type?: "SOFT_REMINDER" | "REMINDER" | "NOTICE_OF_DEBT_COLLECTION" | "DEBT_COLLECTION";
}

export interface Product {
  id: number;
  version?: number;
  name?: string;
  number?: string;
  description?: string;
  ean?: string;
  elNumber?: string;
  nrfNumber?: string;
  costExcludingVat?: number;
  priceExcludingVat?: number;
  priceIncludingVat?: number;
  isInactive?: boolean;
  productUnit?: ProductUnit;
  isStockItem?: boolean;
  stockOfGoods?: number;
  vatType?: VatType;
  currency?: Currency;
  department?: Department;
  account?: Account;
  discountPrice?: number;
  supplier?: Supplier;
  resaleProduct?: Product;
}

export interface ProductUnit {
  id: number;
  version?: number;
  name?: string;
  nameShort?: string;
  commonCode?: string;
}

export interface Inventory {
  id: number;
  version?: number;
  name?: string;
  number?: string;
}

export interface InventoryLocation {
  id: number;
  version?: number;
  inventory?: Inventory;
  name?: string;
  isMainLocation?: boolean;
}

// ==================== SUPPLIER INVOICE (Leverandørfaktura) ====================

export interface SupplierInvoice {
  id: number;
  version?: number;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  amount?: number;
  amountCurrency?: number;
  amountExcludingVat?: number;
  amountExcludingVatCurrency?: number;
  currency?: Currency;
  isCreditNote?: boolean;
  kid?: string;
  paymentAccount?: Account;
  voucher?: Voucher;
  supplier?: Supplier;
  supplierContact?: Contact;
  supplierBankAccount?: string;
  payments?: Posting[];
}

// ==================== API REQUEST PARAMS (Bilag/Voucher) ====================

export interface GetVouchersParams {
  dateFrom?: string;
  dateTo?: string;
  id?: string;
  number?: string;
  numberFrom?: number;
  numberTo?: number;
  typeId?: string;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetAccountsParams {
  id?: string;
  number?: string;
  isBankAccount?: boolean;
  isInactive?: boolean;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetCustomersParams {
  id?: string;
  customerAccountNumber?: string;
  organizationNumber?: string;
  email?: string;
  invoiceEmail?: string;
  isInactive?: boolean;
  accountManagerId?: string;
  isCustomer?: boolean;
  isSupplier?: boolean;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetSuppliersParams {
  id?: string;
  supplierAccountNumber?: string;
  organizationNumber?: string;
  email?: string;
  invoiceEmail?: string;
  isInactive?: boolean;
  accountManagerId?: string;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetInvoicesParams {
  invoiceDateFrom?: string;
  invoiceDateTo?: string;
  id?: string;
  invoiceNumber?: string;
  kid?: string;
  voucherId?: string;
  customerId?: string;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetSupplierInvoicesParams {
  invoiceDateFrom?: string;
  invoiceDateTo?: string;
  id?: string;
  invoiceNumber?: string;
  kid?: string;
  voucherId?: string;
  supplierId?: string;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetProductsParams {
  number?: string;
  name?: string;
  isInactive?: boolean;
  isStockItem?: boolean;
  supplierId?: string;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

export interface GetPostingsParams {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  supplierId?: string;
  customerId?: string;
  employeeId?: string;
  departmentId?: string;
  projectId?: string;
  productId?: string;
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

// ==================== CREATE/UPDATE INPUT TYPES (Bilag) ====================

export interface CreateVoucherInput {
  date: string;
  description?: string;
  type?: { id: number };  // Bilagstype (valgfritt - Tripletex velger automatisk)
  postings: CreatePostingInput[];
}

export interface CreatePostingInput {
  row?: number;           // Radnummer (starter på 0 for første postering)
  date?: string;          // Posteringsdato (overstyrer bilagsdato)
  account: { id: number; name?: string };  // Konto ID og navn (navn er påkrevd i enkelte tilfeller)
  amount?: number;        // Netto-beløp (uten MVA) - bruk enten amount eller amountGross
  amountGross?: number;   // Brutto-beløp (inkl. MVA) - Tripletex beregner MVA automatisk
  amountGrossCurrency?: number;  // Brutto-beløp i valuta
  description?: string;
  customer?: { id: number };
  supplier?: { id: number };
  employee?: { id: number };
  project?: { id: number };
  department?: { id: number };
  vatType?: { id: number };
  currency?: { id: number };
}

export interface CreateCustomerInput {
  name: string;
  organizationNumber?: string;
  email?: string;
  invoiceEmail?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  postalAddress?: CreateAddressInput;
  physicalAddress?: CreateAddressInput;
  isPrivateIndividual?: boolean;
  isCustomer?: boolean;
  invoiceSendMethod?: "EMAIL" | "EHF" | "EFAKTURA" | "AVTALEGIRO" | "VIPPS" | "PAPER" | "MANUAL";
  language?: "NO" | "EN" | "SV";
}

export interface CreateSupplierInput {
  name: string;
  organizationNumber?: string;
  email?: string;
  invoiceEmail?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  postalAddress?: CreateAddressInput;
  physicalAddress?: CreateAddressInput;
  isPrivateIndividual?: boolean;
  isSupplier?: boolean;
  bankAccounts?: string[];
}

export interface CreateAddressInput {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: { id: number };
}

export interface CreateOrderInput {
  customer: { id: number };
  orderDate: string;
  deliveryDate?: string;
  invoicesDueIn?: number;
  invoicesDueInType?: "DAYS" | "MONTHS" | "RECURRING_DAY_OF_MONTH";
  project?: { id: number };
  department?: { id: number };
  orderLines: CreateOrderLineInput[];
  invoiceComment?: string;
  deliveryComment?: string;
}

export interface CreateOrderLineInput {
  product?: { id: number };
  description: string;
  count: number;
  unitPriceExcludingVat?: number;
  unitPriceIncludingVat?: number;
  discount?: number;
  vatType?: { id: number };
}

export interface CreateInvoiceInput {
  invoiceDate: string;
  invoiceDueDate?: string;
  orders: { id: number }[];
  invoiceComment?: string;
}

export interface CreateProductInput {
  name: string;
  number?: string;
  description?: string;
  priceExcludingVat?: number;
  priceIncludingVat?: number;
  vatType?: { id: number };
  account?: { id: number };
  productUnit?: { id: number };
  isInactive?: boolean;
  department?: { id: number };
  supplier?: { id: number };
}

export interface UpdateCustomerInput {
  name?: string;
  organizationNumber?: string;
  email?: string;
  invoiceEmail?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  postalAddress?: CreateAddressInput;
  physicalAddress?: CreateAddressInput;
  isPrivateIndividual?: boolean;
  isCustomer?: boolean;
  isInactive?: boolean;
  invoiceSendMethod?: "EMAIL" | "EHF" | "EFAKTURA" | "AVTALEGIRO" | "VIPPS" | "PAPER" | "MANUAL";
  language?: "NO" | "EN" | "SV";
}

export interface UpdateSupplierInput {
  name?: string;
  organizationNumber?: string;
  email?: string;
  invoiceEmail?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  postalAddress?: CreateAddressInput;
  physicalAddress?: CreateAddressInput;
  isPrivateIndividual?: boolean;
  isSupplier?: boolean;
  isInactive?: boolean;
  bankAccounts?: string[];
}

export interface UpdateProductInput {
  name?: string;
  number?: string;
  description?: string;
  priceExcludingVat?: number;
  priceIncludingVat?: number;
  vatType?: { id: number };
  account?: { id: number };
  productUnit?: { id: number };
  isInactive?: boolean;
  department?: { id: number };
  supplier?: { id: number };
}

// ==================== PAYMENT INPUT ====================

export interface RegisterPaymentInput {
  paymentDate: string;
  paymentTypeId: number;
  amount: number;
  kid?: string;
  bankAccount?: { id: number };
}
