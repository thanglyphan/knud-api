/**
 * Tripletex API Client
 * Wrapper for Tripletex API v2
 * 
 * Focus areas: Employees, Payroll (lønn), A-melding, Vouchers (bilag), 
 * Customers, Suppliers, Invoices, Products, Accounts
 */

import type {
  TripletexListResponse,
  TripletexSingleResponse,
  Employee,
  Employment,
  EmploymentDetails,
  SalaryType,
  Payslip,
  SalaryTransaction,
  SalaryCompilation,
  SalarySettings,
  GetEmployeesParams,
  GetPayslipsParams,
  GetSalaryTransactionsParams,
  CreateSalaryTransactionInput,
  CreateEmployeeInput,
  UpdateEmployeeInput,
  CreateEmploymentInput,
  UpdateEmploymentInput,
  CreateEmploymentDetailsInput,
  Division,
  // Bilag/Voucher types
  Account,
  VatType,
  Voucher,
  VoucherType,
  Posting,
  Customer,
  Supplier,
  Invoice,
  Order,
  SupplierInvoice,
  Product,
  // Params
  GetVouchersParams,
  GetAccountsParams,
  GetCustomersParams,
  GetSuppliersParams,
  GetInvoicesParams,
  GetSupplierInvoicesParams,
  GetProductsParams,
  GetPostingsParams,
  // Create/Update inputs
  CreateVoucherInput,
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateSupplierInput,
  UpdateSupplierInput,
  CreateOrderInput,
  CreateInvoiceInput,
  CreateProductInput,
  UpdateProductInput,
  // Timesheet types
  TimesheetEntry,
  Activity,
  Project,
  GetTimesheetEntriesParams,
  GetActivitiesParams,
  GetProjectsParams,
  CreateTimesheetEntryInput,
  UpdateTimesheetEntryInput,
  TimesheetEntrySearchResponse,
  GetTotalHoursParams,
} from "./types.js";

const TRIPLETEX_API_URL = process.env.TRIPLETEX_API_URL || "https://tripletex.no/v2";

export class TripletexClient {
  private sessionToken: string;
  private companyId: string;

  constructor(sessionToken: string, companyId: string) {
    this.sessionToken = sessionToken;
    this.companyId = companyId;
  }

  /**
   * Make an authenticated request to the Tripletex API
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    // Build URL with query parameters
    const url = new URL(`${TRIPLETEX_API_URL}${endpoint}`);
    
    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Tripletex uses Basic auth with format: 0:sessionToken
    const credentials = Buffer.from(`0:${this.sessionToken}`).toString("base64");

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Tripletex API error [${method} ${endpoint}]:`, response.status, errorText);
      
      let errorMessage = `Tripletex API feil: ${response.status}`;
      
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.message) {
          errorMessage = errorJson.message;
        }
        // Include validation errors if present
        if (errorJson.validationMessages && Array.isArray(errorJson.validationMessages)) {
          const validationDetails = errorJson.validationMessages
            .map((v: { message?: string; field?: string }) => v.message || v.field || JSON.stringify(v))
            .join("; ");
          if (validationDetails) {
            errorMessage += `: ${validationDetails}`;
          }
        }
      } catch {
        // Use default error message
      }
      
      throw new Error(errorMessage);
    }

    // Handle empty responses (e.g., DELETE)
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text);
  }

  // ==================== EMPLOYEES ====================

  /**
   * Get list of employees
   */
  async getEmployees(params?: GetEmployeesParams): Promise<TripletexListResponse<Employee>> {
    return this.request<TripletexListResponse<Employee>>("GET", "/employee", undefined, {
      ...params,
      fields: params?.fields || "id,firstName,lastName,email,employeeNumber,dateOfBirth,employments(*)",
    });
  }

  /**
   * Get a single employee by ID
   */
  async getEmployee(id: number): Promise<TripletexSingleResponse<Employee>> {
    return this.request<TripletexSingleResponse<Employee>>(
      "GET",
      `/employee/${id}`,
      undefined,
      { fields: "*,employments(*),address(*)" }
    );
  }

  /**
   * Get employments for an employee
   */
  async getEmployments(employeeId?: number): Promise<TripletexListResponse<Employment>> {
    return this.request<TripletexListResponse<Employment>>("GET", "/employee/employment", undefined, {
      employeeId: employeeId?.toString(),
      fields: "*,employee(id,firstName,lastName),division(*),employmentDetails(*)",
    });
  }

  /**
   * Get employment details
   */
  async getEmploymentDetails(employmentId?: number): Promise<TripletexListResponse<EmploymentDetails>> {
    return this.request<TripletexListResponse<EmploymentDetails>>(
      "GET",
      "/employee/employment/details",
      undefined,
      {
        employmentId: employmentId?.toString(),
        fields: "*,employment(id,employee(id,firstName,lastName)),occupationCode(*),payrollTaxMunicipalityId(*)",
      }
    );
  }

  // ==================== SALARY TYPES ====================

  /**
   * Get available salary types
   */
  async getSalaryTypes(showInactive = false): Promise<TripletexListResponse<SalaryType>> {
    return this.request<TripletexListResponse<SalaryType>>("GET", "/salary/type", undefined, {
      showInactive,
      fields: "*",
      count: 1000, // Get all salary types
    });
  }

  /**
   * Get a single salary type by ID
   */
  async getSalaryType(id: number): Promise<TripletexSingleResponse<SalaryType>> {
    return this.request<TripletexSingleResponse<SalaryType>>("GET", `/salary/type/${id}`);
  }

  // ==================== PAYSLIPS ====================

  /**
   * Search payslips
   * 
   * IMPORTANT: Tripletex requires BOTH yearFrom+monthFrom AND yearTo+monthTo to be set together.
   * Also, yearTo/monthTo is EXCLUSIVE (to get Dec 2025, use yearTo=2026, monthTo=1)
   */
  async getPayslips(params?: GetPayslipsParams): Promise<TripletexListResponse<Payslip>> {
    // Build query params, ensuring year/month pairs are complete
    const queryParams: Record<string, string | number | boolean | undefined> = {
      fields: params?.fields || "*,employee(id,firstName,lastName),specifications(*,salaryType(*))",
    };

    // Only add date filters if we have complete pairs
    if (params?.yearFrom !== undefined && params?.monthFrom !== undefined) {
      queryParams.yearFrom = params.yearFrom;
      queryParams.monthFrom = params.monthFrom;
    }
    if (params?.yearTo !== undefined && params?.monthTo !== undefined) {
      queryParams.yearTo = params.yearTo;
      queryParams.monthTo = params.monthTo;
    }

    // Add employeeId if provided
    if (params?.employeeId) {
      queryParams.employeeId = params.employeeId;
    }

    // Add pagination
    if (params?.from !== undefined) queryParams.from = params.from;
    if (params?.count !== undefined) queryParams.count = params.count;

    return this.request<TripletexListResponse<Payslip>>("GET", "/salary/payslip", undefined, queryParams);
  }

  /**
   * Get a single payslip by ID
   */
  async getPayslip(id: number): Promise<TripletexSingleResponse<Payslip>> {
    return this.request<TripletexSingleResponse<Payslip>>(
      "GET",
      `/salary/payslip/${id}`,
      undefined,
      { fields: "*,employee(*),specifications(*,salaryType(*))" }
    );
  }

  /**
   * Download payslip as PDF
   * Returns the PDF as a Buffer
   */
  async getPayslipPdf(id: number): Promise<Buffer> {
    const credentials = Buffer.from(`0:${this.sessionToken}`).toString("base64");
    
    const response = await fetch(`${TRIPLETEX_API_URL}/salary/payslip/${id}/pdf`, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Kunne ikke laste ned lønnsslipp: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ==================== SALARY TRANSACTIONS (Lønnskjøring) ====================

  /**
   * Search salary transactions (lønnskjøringer)
   */
  async getSalaryTransactions(params?: GetSalaryTransactionsParams): Promise<TripletexListResponse<SalaryTransaction>> {
    return this.request<TripletexListResponse<SalaryTransaction>>("GET", "/salary/transaction", undefined, {
      ...params,
      fields: params?.fields || "*,payslips(id,employee(id,firstName,lastName),amount,grossAmount)",
    });
  }

  /**
   * Get a single salary transaction
   */
  async getSalaryTransaction(id: number): Promise<TripletexSingleResponse<SalaryTransaction>> {
    return this.request<TripletexSingleResponse<SalaryTransaction>>(
      "GET",
      `/salary/transaction/${id}`,
      undefined,
      { fields: "*,payslips(*,employee(*),specifications(*,salaryType(*)))" }
    );
  }

  /**
   * Create a new salary transaction (lønnskjøring)
   * @param input - Salary transaction data with payslips
   * @param generateTaxDeduction - If true, Tripletex will auto-calculate tax deductions (default: true)
   */
  async createSalaryTransaction(
    input: CreateSalaryTransactionInput,
    generateTaxDeduction: boolean = true
  ): Promise<TripletexSingleResponse<SalaryTransaction>> {
    return this.request<TripletexSingleResponse<SalaryTransaction>>(
      "POST",
      "/salary/transaction",
      input,
      { generateTaxDeduction }
    );
  }

  /**
   * Delete a salary transaction
   */
  async deleteSalaryTransaction(id: number): Promise<void> {
    await this.request<void>("DELETE", `/salary/transaction/${id}`);
  }

  // ==================== SALARY COMPILATION (Lønnsoversikt) ====================

  /**
   * Get salary compilation for a period for a specific employee
   * Note: This endpoint requires employeeId
   */
  async getSalaryCompilation(year: number, employeeId: number): Promise<TripletexSingleResponse<SalaryCompilation>> {
    return this.request<TripletexSingleResponse<SalaryCompilation>>(
      "GET",
      "/salary/compilation",
      undefined,
      {
        year,
        employeeId,
      }
    );
  }

  // ==================== SALARY SETTINGS ====================

  /**
   * Get salary settings
   */
  async getSalarySettings(): Promise<TripletexSingleResponse<SalarySettings>> {
    return this.request<TripletexSingleResponse<SalarySettings>>("GET", "/salary/settings");
  }

  /**
   * Update salary settings
   */
  async updateSalarySettings(settings: Partial<SalarySettings>): Promise<TripletexSingleResponse<SalarySettings>> {
    const current = await this.getSalarySettings();
    return this.request<TripletexSingleResponse<SalarySettings>>(
      "PUT",
      `/salary/settings/${current.value.id}`,
      { ...current.value, ...settings }
    );
  }

  // ==================== A-MELDING / RECONCILIATION ====================

  /**
   * Create or get tax deduction reconciliation context
   * Note: 'term' is the bimonthly period (1-6), where:
   * - term 1 = Jan-Feb
   * - term 2 = Mar-Apr
   * - term 3 = May-Jun
   * - term 4 = Jul-Aug
   * - term 5 = Sep-Oct
   * - term 6 = Nov-Dec
   */
  async createTaxDeductionReconciliation(year: number, term: number): Promise<TripletexSingleResponse<{ id: number }>> {
    return this.request<TripletexSingleResponse<{ id: number }>>(
      "POST",
      "/salary/taxDeduction/reconciliation/context",
      { year, term }
    );
  }

  /**
   * Get tax deduction reconciliation overview
   */
  async getTaxDeductionOverview(contextId: number): Promise<TripletexSingleResponse<{
    totalPayments: number;
    taxDeductionBalance: number;
  }>> {
    return this.request<TripletexSingleResponse<{
      totalPayments: number;
      taxDeductionBalance: number;
    }>>("GET", `/salary/taxDeduction/reconciliation/${contextId}/overview`);
  }

  /**
   * Create or get payroll tax reconciliation context
   * Note: 'term' is the bimonthly period (1-6)
   */
  async createPayrollTaxReconciliation(year: number, term: number): Promise<TripletexSingleResponse<{ id: number }>> {
    return this.request<TripletexSingleResponse<{ id: number }>>(
      "POST",
      "/salary/payrollTax/reconciliation/context",
      { year, term }
    );
  }

  /**
   * Get payroll tax reconciliation overview
   */
  async getPayrollTaxOverview(contextId: number): Promise<TripletexSingleResponse<{
    totalPayments: number;
    payrollTaxBalance: number;
  }>> {
    return this.request<TripletexSingleResponse<{
      totalPayments: number;
      payrollTaxBalance: number;
    }>>("GET", `/salary/payrollTax/reconciliation/${contextId}/overview`);
  }

  // ==================== EMPLOYEE CRUD ====================

  /**
   * Create a new employee
   */
  async createEmployee(data: CreateEmployeeInput): Promise<TripletexSingleResponse<Employee>> {
    return this.request<TripletexSingleResponse<Employee>>("POST", "/employee", data);
  }

  /**
   * Update an existing employee
   */
  async updateEmployee(id: number, data: UpdateEmployeeInput): Promise<TripletexSingleResponse<Employee>> {
    // First get the current employee data
    const current = await this.getEmployee(id);
    
    // Merge with updates
    const updated = {
      ...current.value,
      ...data,
      // Handle nested address object
      address: data.address ? {
        ...current.value.address,
        ...data.address,
      } : current.value.address,
    };

    return this.request<TripletexSingleResponse<Employee>>("PUT", `/employee/${id}`, updated);
  }

  // ==================== EMPLOYMENT CRUD ====================

  /**
   * Get company divisions (virksomheter/underenheter)
   */
  async getDivisions(): Promise<TripletexListResponse<Division>> {
    return this.request<TripletexListResponse<Division>>("GET", "/division", undefined, { count: 100 });
  }

  /**
   * Create a new employment for an employee
   */
  async createEmployment(data: CreateEmploymentInput): Promise<TripletexSingleResponse<Employment>> {
    return this.request<TripletexSingleResponse<Employment>>("POST", "/employee/employment", data);
  }

  /**
   * Update an existing employment
   */
  async updateEmployment(id: number, data: UpdateEmploymentInput): Promise<TripletexSingleResponse<Employment>> {
    // First get the current employment data
    const employments = await this.getEmployments();
    const current = employments.values.find(e => e.id === id);
    
    if (!current) {
      throw new Error(`Arbeidsforhold med ID ${id} ble ikke funnet`);
    }

    // Merge with updates
    const updated = {
      ...current,
      ...data,
    };

    return this.request<TripletexSingleResponse<Employment>>("PUT", `/employee/employment/${id}`, updated);
  }

  /**
   * Create employment details (for updating salary, position percentage, etc.)
   */
  async createEmploymentDetails(
    employmentId: number,
    data: CreateEmploymentDetailsInput
  ): Promise<TripletexSingleResponse<EmploymentDetails>> {
    return this.request<TripletexSingleResponse<EmploymentDetails>>(
      "POST",
      "/employee/employment/details",
      {
        employment: { id: employmentId },
        ...data,
      }
    );
  }

  // ==================== ACCOUNTS (Kontoplan) ====================

  /**
   * Get list of accounts from the chart of accounts
   */
  async getAccounts(params?: GetAccountsParams): Promise<TripletexListResponse<Account>> {
    return this.request<TripletexListResponse<Account>>("GET", "/ledger/account", undefined, {
      ...params,
      fields: params?.fields || "id,number,name,description,type,vatType(*),isInactive,isBankAccount,requireReconciliation",
      count: params?.count || 1000,
    });
  }

  /**
   * Get a single account by ID
   */
  async getAccount(id: number): Promise<TripletexSingleResponse<Account>> {
    return this.request<TripletexSingleResponse<Account>>(
      "GET",
      `/ledger/account/${id}`,
      undefined,
      { fields: "*,vatType(*)" }
    );
  }

  /**
   * Search accounts by number
   */
  async getAccountByNumber(accountNumber: number): Promise<Account | null> {
    const result = await this.getAccounts({ number: accountNumber.toString() });
    return result.values.length > 0 ? result.values[0] : null;
  }

  // ==================== VAT TYPES (MVA-typer) ====================

  /**
   * Get list of VAT types
   */
  async getVatTypes(): Promise<TripletexListResponse<VatType>> {
    return this.request<TripletexListResponse<VatType>>("GET", "/ledger/vatType", undefined, {
      fields: "*",
      count: 100,
    });
  }

  /**
   * Get a single VAT type by ID
   */
  async getVatType(id: number): Promise<TripletexSingleResponse<VatType>> {
    return this.request<TripletexSingleResponse<VatType>>("GET", `/ledger/vatType/${id}`);
  }

  // ==================== VOUCHERS (Bilag) ====================

  /**
   * Search vouchers (bilag)
   */
  async getVouchers(params?: GetVouchersParams): Promise<TripletexListResponse<Voucher>> {
    return this.request<TripletexListResponse<Voucher>>("GET", "/ledger/voucher", undefined, {
      ...params,
      fields: params?.fields || "id,number,date,description,year,voucherType(*),postings(*,account(id,number,name),vatType(*))",
      count: params?.count || 100,
    });
  }

  /**
   * Get a single voucher by ID
   */
  async getVoucher(id: number): Promise<TripletexSingleResponse<Voucher>> {
    return this.request<TripletexSingleResponse<Voucher>>(
      "GET",
      `/ledger/voucher/${id}`,
      undefined,
      { fields: "*,voucherType(*),postings(*,account(*),customer(*),supplier(*),vatType(*)),document(*),attachment(*)" }
    );
  }

  /**
   * Create a new voucher (bilag)
   * @param input Bilag-data med posteringer
   * @param sendToLedger Send direkte til reskontro (default: false - forblir i mottak)
   */
  async createVoucher(input: CreateVoucherInput, sendToLedger = false): Promise<TripletexSingleResponse<Voucher>> {
    return this.request<TripletexSingleResponse<Voucher>>(
      "POST", 
      "/ledger/voucher", 
      input,
      { sendToLedger }
    );
  }

  /**
   * Delete a voucher
   */
  async deleteVoucher(id: number): Promise<void> {
    await this.request<void>("DELETE", `/ledger/voucher/${id}`);
  }

  /**
   * Reverse a voucher (creates a reversing voucher)
   */
  async reverseVoucher(id: number, date: string): Promise<TripletexSingleResponse<Voucher>> {
    return this.request<TripletexSingleResponse<Voucher>>(
      "PUT",
      `/ledger/voucher/${id}/:reverse`,
      undefined,
      { date }
    );
  }

  /**
   * Get voucher types
   */
  async getVoucherTypes(): Promise<TripletexListResponse<VoucherType>> {
    return this.request<TripletexListResponse<VoucherType>>("GET", "/ledger/voucherType", undefined, {
      fields: "*",
      count: 100,
    });
  }

  /**
   * Get voucher as PDF
   */
  async getVoucherPdf(id: number): Promise<Buffer> {
    const credentials = Buffer.from(`0:${this.sessionToken}`).toString("base64");
    
    const response = await fetch(`${TRIPLETEX_API_URL}/ledger/voucher/${id}/pdf`, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Kunne ikke laste ned bilag som PDF: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Upload attachment to a voucher
   */
  async uploadVoucherAttachment(voucherId: number, file: Buffer, filename: string): Promise<void> {
    const credentials = Buffer.from(`0:${this.sessionToken}`).toString("base64");
    
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(file)]), filename);
    
    const response = await fetch(`${TRIPLETEX_API_URL}/ledger/voucher/${voucherId}/attachment`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kunne ikke laste opp vedlegg: ${response.status} - ${errorText}`);
    }
  }

  // ==================== POSTINGS (Posteringer) ====================

  /**
   * Search postings
   */
  async getPostings(params?: GetPostingsParams): Promise<TripletexListResponse<Posting>> {
    return this.request<TripletexListResponse<Posting>>("GET", "/ledger/posting", undefined, {
      ...params,
      fields: params?.fields || "*,account(*),customer(*),supplier(*),voucher(id,number,date),vatType(*)",
      count: params?.count || 100,
    });
  }

  // ==================== CUSTOMERS (Kunder) ====================

  /**
   * Search customers
   */
  async getCustomers(params?: GetCustomersParams): Promise<TripletexListResponse<Customer>> {
    return this.request<TripletexListResponse<Customer>>("GET", "/customer", undefined, {
      ...params,
      fields: params?.fields || "id,name,organizationNumber,customerNumber,email,invoiceEmail,phoneNumber,isInactive,postalAddress(*)",
      count: params?.count || 100,
    });
  }

  /**
   * Get a single customer by ID
   */
  async getCustomer(id: number): Promise<TripletexSingleResponse<Customer>> {
    return this.request<TripletexSingleResponse<Customer>>(
      "GET",
      `/customer/${id}`,
      undefined,
      { fields: "*,postalAddress(*),physicalAddress(*),deliveryAddress(*)" }
    );
  }

  /**
   * Create a new customer
   */
  async createCustomer(input: CreateCustomerInput): Promise<TripletexSingleResponse<Customer>> {
    return this.request<TripletexSingleResponse<Customer>>("POST", "/customer", {
      ...input,
      isCustomer: true,
    });
  }

  /**
   * Update a customer
   */
  async updateCustomer(id: number, input: UpdateCustomerInput): Promise<TripletexSingleResponse<Customer>> {
    const current = await this.getCustomer(id);
    return this.request<TripletexSingleResponse<Customer>>("PUT", `/customer/${id}`, {
      ...current.value,
      ...input,
    });
  }

  /**
   * Delete a customer
   */
  async deleteCustomer(id: number): Promise<void> {
    await this.request<void>("DELETE", `/customer/${id}`);
  }

  /**
   * Search customer by name
   */
  async searchCustomerByName(name: string): Promise<Customer[]> {
    // Tripletex doesn't have a direct name search, so we get all and filter
    const result = await this.getCustomers({ count: 1000 });
    const lowerName = name.toLowerCase();
    return result.values.filter(c => 
      c.name.toLowerCase().includes(lowerName) ||
      c.organizationNumber?.includes(name)
    );
  }

  // ==================== SUPPLIERS (Leverandører) ====================

  /**
   * Search suppliers
   */
  async getSuppliers(params?: GetSuppliersParams): Promise<TripletexListResponse<Supplier>> {
    return this.request<TripletexListResponse<Supplier>>("GET", "/supplier", undefined, {
      ...params,
      fields: params?.fields || "id,name,organizationNumber,supplierNumber,email,invoiceEmail,phoneNumber,isInactive,postalAddress(*),bankAccounts",
      count: params?.count || 100,
    });
  }

  /**
   * Get a single supplier by ID
   */
  async getSupplier(id: number): Promise<TripletexSingleResponse<Supplier>> {
    return this.request<TripletexSingleResponse<Supplier>>(
      "GET",
      `/supplier/${id}`,
      undefined,
      { fields: "*,postalAddress(*),physicalAddress(*)" }
    );
  }

  /**
   * Create a new supplier
   */
  async createSupplier(input: CreateSupplierInput): Promise<TripletexSingleResponse<Supplier>> {
    return this.request<TripletexSingleResponse<Supplier>>("POST", "/supplier", {
      ...input,
      isSupplier: true,
    });
  }

  /**
   * Update a supplier
   */
  async updateSupplier(id: number, input: UpdateSupplierInput): Promise<TripletexSingleResponse<Supplier>> {
    const current = await this.getSupplier(id);
    return this.request<TripletexSingleResponse<Supplier>>("PUT", `/supplier/${id}`, {
      ...current.value,
      ...input,
    });
  }

  /**
   * Delete a supplier
   */
  async deleteSupplier(id: number): Promise<void> {
    await this.request<void>("DELETE", `/supplier/${id}`);
  }

  /**
   * Search supplier by name
   */
  async searchSupplierByName(name: string): Promise<Supplier[]> {
    const result = await this.getSuppliers({ count: 1000 });
    const lowerName = name.toLowerCase();
    return result.values.filter(s => 
      s.name.toLowerCase().includes(lowerName) ||
      s.organizationNumber?.includes(name)
    );
  }

  // ==================== INVOICES (Utgående fakturaer) ====================

  /**
   * Search invoices
   */
  async getInvoices(params?: GetInvoicesParams): Promise<TripletexListResponse<Invoice>> {
    return this.request<TripletexListResponse<Invoice>>("GET", "/invoice", undefined, {
      ...params,
      fields: params?.fields || "id,invoiceNumber,invoiceDate,invoiceDueDate,amount,amountOutstanding,currency(*),orders(id,customer(id,name)),isCreditNote,isCharged",
      count: params?.count || 100,
    });
  }

  /**
   * Get a single invoice by ID
   */
  async getInvoice(id: number): Promise<TripletexSingleResponse<Invoice>> {
    return this.request<TripletexSingleResponse<Invoice>>(
      "GET",
      `/invoice/${id}`,
      undefined,
      { fields: "*,orders(*,customer(*),orderLines(*,product(*),vatType(*))),voucher(*),postings(*)" }
    );
  }

  /**
   * Get invoice as PDF
   */
  async getInvoicePdf(id: number): Promise<Buffer> {
    const credentials = Buffer.from(`0:${this.sessionToken}`).toString("base64");
    
    const response = await fetch(`${TRIPLETEX_API_URL}/invoice/${id}/pdf`, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Kunne ikke laste ned faktura som PDF: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ==================== ORDERS (Ordrer - for fakturering) ====================

  /**
   * Create an order (required before creating invoice)
   */
  async createOrder(input: CreateOrderInput): Promise<TripletexSingleResponse<Order>> {
    return this.request<TripletexSingleResponse<Order>>("POST", "/order", input);
  }

  /**
   * Get an order by ID
   */
  async getOrder(id: number): Promise<TripletexSingleResponse<Order>> {
    return this.request<TripletexSingleResponse<Order>>(
      "GET",
      `/order/${id}`,
      undefined,
      { fields: "*,customer(*),orderLines(*,product(*),vatType(*))" }
    );
  }

  /**
   * Create invoice from orders
   */
  async createInvoice(input: CreateInvoiceInput): Promise<TripletexSingleResponse<Invoice>> {
    return this.request<TripletexSingleResponse<Invoice>>("POST", "/invoice", input);
  }

  /**
   * Send invoice via email or EHF
   */
  async sendInvoice(
    invoiceId: number, 
    sendType: "EMAIL" | "EHF" | "EFAKTURA" = "EMAIL",
    overrideEmailOrNumber?: string
  ): Promise<void> {
    await this.request<void>(
      "PUT",
      `/invoice/${invoiceId}/:send`,
      undefined,
      { sendType, overrideEmailOrNumber }
    );
  }

  /**
   * Create credit note from invoice
   */
  async createCreditNote(invoiceId: number, comment?: string): Promise<TripletexSingleResponse<Invoice>> {
    return this.request<TripletexSingleResponse<Invoice>>(
      "PUT",
      `/invoice/${invoiceId}/:createCreditNote`,
      undefined,
      { comment }
    );
  }

  // ==================== SUPPLIER INVOICES (Leverandørfakturaer) ====================

  /**
   * Search supplier invoices
   */
  async getSupplierInvoices(params?: GetSupplierInvoicesParams): Promise<TripletexListResponse<SupplierInvoice>> {
    return this.request<TripletexListResponse<SupplierInvoice>>("GET", "/supplierInvoice", undefined, {
      ...params,
      fields: params?.fields || "id,invoiceNumber,invoiceDate,amount,amountCurrency,currency(*),supplier(id,name),isCreditNote,voucher(id,number)",
      count: params?.count || 100,
    });
  }

  /**
   * Get a single supplier invoice by ID
   */
  async getSupplierInvoice(id: number): Promise<TripletexSingleResponse<SupplierInvoice>> {
    return this.request<TripletexSingleResponse<SupplierInvoice>>(
      "GET",
      `/supplierInvoice/${id}`,
      undefined,
      { fields: "*,supplier(*),voucher(*,postings(*)),payments(*)" }
    );
  }

  /**
   * Get supplier invoice as PDF
   */
  async getSupplierInvoicePdf(id: number): Promise<Buffer> {
    const credentials = Buffer.from(`0:${this.sessionToken}`).toString("base64");
    
    const response = await fetch(`${TRIPLETEX_API_URL}/supplierInvoice/${id}/pdf`, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Kunne ikke laste ned leverandørfaktura som PDF: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Get supplier invoices pending approval
   */
  async getSupplierInvoicesForApproval(): Promise<TripletexListResponse<SupplierInvoice>> {
    return this.request<TripletexListResponse<SupplierInvoice>>(
      "GET",
      "/supplierInvoice/forApproval",
      undefined,
      { fields: "*,supplier(*)" }
    );
  }

  /**
   * Approve supplier invoices
   */
  async approveSupplierInvoices(invoiceIds: number[], comment?: string): Promise<void> {
    await this.request<void>(
      "PUT",
      "/supplierInvoice/:approve",
      { invoiceIds },
      { comment }
    );
  }

  /**
   * Reject supplier invoices
   */
  async rejectSupplierInvoices(invoiceIds: number[], comment: string): Promise<void> {
    await this.request<void>(
      "PUT",
      "/supplierInvoice/:reject",
      { invoiceIds },
      { comment }
    );
  }

  /**
   * Add payment to supplier invoice
   */
  async addSupplierInvoicePayment(
    invoiceId: number, 
    paymentDate: string, 
    amount: number,
    bankAccountId?: number
  ): Promise<void> {
    await this.request<void>(
      "POST",
      `/supplierInvoice/${invoiceId}/:addPayment`,
      {
        paymentDate,
        amount,
        ...(bankAccountId && { bankAccount: { id: bankAccountId } }),
      }
    );
  }

  // ==================== PRODUCTS ====================

  /**
   * Search products
   */
  async getProducts(params?: GetProductsParams): Promise<TripletexListResponse<Product>> {
    return this.request<TripletexListResponse<Product>>("GET", "/product", undefined, {
      ...params,
      fields: params?.fields || "id,number,name,description,priceExcludingVatCurrency,priceIncludingVatCurrency,vatType(*),account(*),isInactive",
      count: params?.count || 100,
    });
  }

  /**
   * Get a single product by ID
   */
  async getProduct(id: number): Promise<TripletexSingleResponse<Product>> {
    return this.request<TripletexSingleResponse<Product>>(
      "GET",
      `/product/${id}`,
      undefined,
      { fields: "*,vatType(*),account(*),supplier(*)" }
    );
  }

  /**
   * Create a new product
   */
  async createProduct(input: CreateProductInput): Promise<TripletexSingleResponse<Product>> {
    return this.request<TripletexSingleResponse<Product>>("POST", "/product", input);
  }

  /**
   * Update a product
   */
  async updateProduct(id: number, input: UpdateProductInput): Promise<TripletexSingleResponse<Product>> {
    const current = await this.getProduct(id);
    return this.request<TripletexSingleResponse<Product>>("PUT", `/product/${id}`, {
      ...current.value,
      ...input,
    });
  }

  /**
   * Delete a product
   */
  async deleteProduct(id: number): Promise<void> {
    await this.request<void>("DELETE", `/product/${id}`);
  }

  // ==================== HELPER METHODS ====================

  /**
   * Get financial summary (income, expenses, result) for a period
   * - Income: From ledger postings on accounts 3000-3999 (revenue accounts)
   * - Expenses: From ledger postings on accounts 4000-7999 (cost accounts)
   * 
   * Uses postings instead of invoices for more accurate accounting data.
   * Returns amounts in øre (cents) to match Fiken format.
   */
  async getFinancialSummary(fromDate: string, toDate: string): Promise<{
    period: { from: string; to: string };
    income: number;
    expenses: number;
    result: number;
  }> {
    // Hent alle posteringer for perioden
    let allPostings: Posting[] = [];
    let postingOffset = 0;
    const pageSize = 1000;
    let hasMorePostings = true;

    while (hasMorePostings) {
      const postings = await this.getPostings({
        dateFrom: fromDate,
        dateTo: toDate,
        from: postingOffset,
        count: pageSize,
      });
      
      allPostings = allPostings.concat(postings.values);
      
      if (postings.values.length < pageSize) {
        hasMorePostings = false;
      } else {
        postingOffset += pageSize;
        if (postingOffset > 50000) hasMorePostings = false;
      }
    }

    let income = 0;
    let expenses = 0;

    for (const posting of allPostings) {
      const accountNumber = posting.account?.number || 0;
      // Sikrer mot NaN/Infinity ved å bruke Number.isFinite
      const rawAmount = posting.amount ?? 0;
      const amount = Number.isFinite(rawAmount) ? rawAmount : 0;

      // Norwegian standard chart of accounts (NS 4102):
      // 3000-3999: Revenue/income (credit = negative amounts in Tripletex)
      // Income is typically posted as negative (credit), so we negate it
      if (accountNumber >= 3000 && accountNumber < 4000) {
        income += Math.abs(amount);
      }
      // 4000-7999: Costs/expenses (debit = positive amounts)
      else if (accountNumber >= 4000 && accountNumber < 8000) {
        expenses += Math.abs(amount);
      }
    }

    // Convert to øre (multiply by 100) to match Fiken format
    // Final safety check to ensure no NaN values are returned
    const safeIncome = Number.isFinite(income) ? income : 0;
    const safeExpenses = Number.isFinite(expenses) ? expenses : 0;
    const safeResult = safeIncome - safeExpenses;

    console.log('[Tripletex] Financial summary calculated:', {
      postingCount: allPostings.length,
      income: safeIncome,
      expenses: safeExpenses,
      result: safeResult,
    });

    return {
      period: { from: fromDate, to: toDate },
      income: Math.round(safeIncome * 100),
      expenses: Math.round(safeExpenses * 100),
      result: Math.round(safeResult * 100),
    };
  }

  /**
   * Get a summary of payroll for a specific month
   * Fetches all payslips for the period and calculates totals
   */
  async getPayrollSummary(year: number, month: number): Promise<{
    year: number;
    month: number;
    employees: Array<{
      id: number;
      name: string;
      grossSalary: number;
      taxDeduction: number;
      netPaid: number;
    }>;
    totals: {
      grossSalary: number;
      taxDeduction: number;
      payrollTax: number;
      netPaid: number;
    };
  }> {
    // Calculate exclusive end date for Tripletex
    let yearTo = year;
    let monthTo = month + 1;
    if (month === 12) {
      yearTo = year + 1;
      monthTo = 1;
    }

    // Get all payslips for the period
    const payslips = await this.getPayslips({
      yearFrom: year,
      monthFrom: month,
      yearTo,
      monthTo,
      fields: "*,employee(id,firstName,lastName)",
    });

    // Group by employee and calculate totals
    const employeeMap = new Map<number, {
      id: number;
      name: string;
      grossSalary: number;
      taxDeduction: number;
      netPaid: number;
      payrollTax: number;
    }>();

    let totalGross = 0;
    let totalTax = 0;
    let totalPayrollTax = 0;
    let totalNet = 0;

    for (const ps of payslips.values) {
      const empId = ps.employee?.id || 0;
      const empName = ps.employee 
        ? `${ps.employee.firstName || ""} ${ps.employee.lastName || ""}`.trim()
        : "Ukjent";
      
      const gross = ps.grossAmount || 0;
      const tax = ps.taxDeductionAmount || 0;
      const net = ps.amount || 0;
      const payrollTax = ps.payrollTaxAmount || 0;

      if (employeeMap.has(empId)) {
        const emp = employeeMap.get(empId)!;
        emp.grossSalary += gross;
        emp.taxDeduction += tax;
        emp.netPaid += net;
        emp.payrollTax += payrollTax;
      } else {
        employeeMap.set(empId, {
          id: empId,
          name: empName,
          grossSalary: gross,
          taxDeduction: tax,
          netPaid: net,
          payrollTax: payrollTax,
        });
      }

      totalGross += gross;
      totalTax += tax;
      totalPayrollTax += payrollTax;
      totalNet += net;
    }

    return {
      year,
      month,
      employees: Array.from(employeeMap.values()).map(e => ({
        id: e.id,
        name: e.name,
        grossSalary: e.grossSalary,
        taxDeduction: e.taxDeduction,
        netPaid: e.netPaid,
      })),
      totals: {
        grossSalary: totalGross,
        taxDeduction: totalTax,
        payrollTax: totalPayrollTax,
        netPaid: totalNet,
      },
    };
  }

  // ==================== TIMESHEET (Timeføring) ====================

  /**
   * Søk etter timeregistreringer.
   * dateFrom og dateTo er PÅKREVD av Tripletex API.
   */
  async getTimesheetEntries(params: GetTimesheetEntriesParams): Promise<TimesheetEntrySearchResponse> {
    return this.request<TimesheetEntrySearchResponse>("GET", "/timesheet/entry", undefined, {
      ...params,
      fields: params.fields || "id,version,project(id,name,number),activity(id,name,number),date,hours,chargeableHours,employee(id,firstName,lastName),comment,locked,chargeable,hourlyRate",
      count: params.count || 100,
    });
  }

  /**
   * Hent en enkelt timeregistrering
   */
  async getTimesheetEntry(id: number): Promise<TripletexSingleResponse<TimesheetEntry>> {
    return this.request<TripletexSingleResponse<TimesheetEntry>>(
      "GET",
      `/timesheet/entry/${id}`,
      undefined,
      { fields: "*,project(id,name,number),activity(id,name,number),employee(id,firstName,lastName)" }
    );
  }

  /**
   * Opprett ny timeregistrering.
   * Merk: Kun én registrering per ansatt/dato/aktivitet/prosjekt-kombinasjon.
   */
  async createTimesheetEntry(input: CreateTimesheetEntryInput): Promise<TripletexSingleResponse<TimesheetEntry>> {
    return this.request<TripletexSingleResponse<TimesheetEntry>>("POST", "/timesheet/entry", input);
  }

  /**
   * Oppdater en timeregistrering (henter eksisterende først, merger endringer)
   */
  async updateTimesheetEntry(id: number, input: UpdateTimesheetEntryInput): Promise<TripletexSingleResponse<TimesheetEntry>> {
    const current = await this.getTimesheetEntry(id);
    return this.request<TripletexSingleResponse<TimesheetEntry>>("PUT", `/timesheet/entry/${id}`, {
      ...current.value,
      ...input,
    });
  }

  /**
   * Slett en timeregistrering.
   * Henter gjeldende versjon automatisk hvis version ikke er oppgitt.
   */
  async deleteTimesheetEntry(id: number, version?: number): Promise<void> {
    let ver = version;
    if (ver === undefined) {
      const current = await this.getTimesheetEntry(id);
      ver = current.value.version;
    }
    await this.request<void>("DELETE", `/timesheet/entry/${id}`, undefined, {
      version: ver,
    });
  }

  /**
   * Hent totale timer for en ansatt i en periode
   */
  async getTimesheetTotalHours(params?: GetTotalHoursParams): Promise<TripletexSingleResponse<{ value: number }>> {
    return this.request<TripletexSingleResponse<{ value: number }>>(
      "GET",
      "/timesheet/entry/>totalHours",
      undefined,
      {
        employeeId: params?.employeeId,
        startDate: params?.startDate,
        endDate: params?.endDate,
        fields: params?.fields || "*",
      }
    );
  }

  /**
   * Hent nylig brukte prosjekter for timeregistrering
   */
  async getRecentTimesheetProjects(employeeId?: number): Promise<TripletexListResponse<Project>> {
    return this.request<TripletexListResponse<Project>>(
      "GET",
      "/timesheet/entry/>recentProjects",
      undefined,
      {
        employeeId,
        fields: "id,name,number,displayName,description",
      }
    );
  }

  /**
   * Hent nylig brukte aktiviteter for timeregistrering
   */
  async getRecentTimesheetActivities(projectId: number, employeeId?: number): Promise<TripletexListResponse<Activity>> {
    return this.request<TripletexListResponse<Activity>>(
      "GET",
      "/timesheet/entry/>recentActivities",
      undefined,
      {
        projectId,
        employeeId,
        fields: "id,name,number,displayName,description,isProjectActivity",
      }
    );
  }

  // ==================== ACTIVITIES (Aktiviteter) ====================

  /**
   * Hent liste over aktiviteter
   */
  async getActivities(params?: GetActivitiesParams): Promise<TripletexListResponse<Activity>> {
    return this.request<TripletexListResponse<Activity>>("GET", "/activity", undefined, {
      ...params,
      fields: params?.fields || "id,name,number,description,activityType,isProjectActivity,isGeneral,isTask,isDisabled,isChargeable,rate,displayName",
      count: params?.count || 100,
    });
  }

  /**
   * Hent en enkelt aktivitet
   */
  async getActivity(id: number): Promise<TripletexSingleResponse<Activity>> {
    return this.request<TripletexSingleResponse<Activity>>(
      "GET",
      `/activity/${id}`,
      undefined,
      { fields: "*" }
    );
  }

  /**
   * Hent aktiviteter tilgjengelig for timeregistrering (filtrert for et prosjekt)
   */
  async getActivitiesForTimeSheet(projectId: number, employeeId?: number, date?: string): Promise<TripletexListResponse<Activity>> {
    return this.request<TripletexListResponse<Activity>>(
      "GET",
      "/activity/>forTimeSheet",
      undefined,
      {
        projectId,
        employeeId,
        date,
        fields: "id,name,number,displayName,isProjectActivity,isChargeable",
      }
    );
  }

  // ==================== PROJECTS (Prosjekter) ====================

  /**
   * Hent liste over prosjekter
   */
  async getProjects(params?: GetProjectsParams): Promise<TripletexListResponse<Project>> {
    return this.request<TripletexListResponse<Project>>("GET", "/project", undefined, {
      ...params,
      fields: params?.fields || "id,name,number,displayName,description,projectManager(id,firstName,lastName),startDate,endDate,isClosed,isFixedPrice,customer(id,name)",
      count: params?.count || 100,
    });
  }

  /**
   * Hent et enkelt prosjekt
   */
  async getProject(id: number): Promise<TripletexSingleResponse<Project>> {
    return this.request<TripletexSingleResponse<Project>>(
      "GET",
      `/project/${id}`,
      undefined,
      { fields: "*,projectManager(*),customer(*)" }
    );
  }

  /**
   * Hent prosjekter tilgjengelig for timeregistrering
   */
  async getProjectsForTimeSheet(employeeId?: number, date?: string): Promise<TripletexListResponse<Project>> {
    return this.request<TripletexListResponse<Project>>(
      "GET",
      "/project/>forTimeSheet",
      undefined,
      {
        employeeId,
        date,
        fields: "id,name,number,displayName,description",
      }
    );
  }
}

/**
 * Factory function to create a Tripletex client
 */
export function createTripletexClient(sessionToken: string, companyId: string): TripletexClient {
  return new TripletexClient(sessionToken, companyId);
}
