/**
 * Tripletex API Client
 *
 * Forenklet API-klient med direkte metoder for de mest brukte endepunktene.
 * Ingen dynamisk OpenAPI-generering - alt er håndskrevet og optimalisert.
 */

// ==================== Configuration ====================

const TRIPLETEX_API_URL =
  process.env.TRIPLETEX_API_URL || "https://api.tripletex.io/v2";

// ==================== Types ====================

export interface TripletexClientConfig {
  sessionToken: string;
  companyId: string;
  baseUrl?: string;
}

export interface TripletexResponse<T = unknown> {
  value?: T;
  values?: T[];
  fullResultSize?: number;
  from?: number;
  count?: number;
}

export interface PaginationParams {
  from?: number;
  count?: number;
  sorting?: string;
  fields?: string;
}

// Core business types
export interface Customer {
  id: number;
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  invoiceEmail?: string;
  customerNumber?: number;
  isCustomer?: boolean;
  isSupplier?: boolean;
  isInactive?: boolean;
  accountManager?: { id: number };
  postalAddress?: Address;
  physicalAddress?: Address;
}

export interface Supplier {
  id: number;
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  supplierNumber?: number;
  isCustomer?: boolean;
  isSupplier?: boolean;
  isInactive?: boolean;
  postalAddress?: Address;
}

export interface Address {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: { id: number };
}

export interface Product {
  id: number;
  name: string;
  number?: string;
  description?: string;
  priceExcludingVatCurrency?: number;
  priceIncludingVatCurrency?: number;
  vatType?: { id: number };
  isInactive?: boolean;
  productUnit?: { id: number };
  account?: { id: number };
}

export interface Invoice {
  id: number;
  invoiceNumber?: number;
  invoiceDate?: string;
  dueDate?: string;
  customer?: { id: number; name?: string };
  orders?: Array<{ id: number }>;
  amount?: number;
  amountCurrency?: number;
  amountExcludingVat?: number;
  amountExcludingVatCurrency?: number;
  currency?: { id: number; code?: string };
  isCreditNote?: boolean;
  isPaid?: boolean;
  comment?: string;
}

export interface Order {
  id: number;
  number?: string;
  orderDate?: string;
  deliveryDate?: string;
  customer?: { id: number; name?: string };
  orderLines?: OrderLine[];
  deliveryAddress?: Address;
  isClosed?: boolean;
  isSubscription?: boolean;
}

export interface OrderLine {
  id?: number;
  product?: { id: number };
  description?: string;
  count?: number;
  unitPriceExcludingVatCurrency?: number;
  discount?: number;
  vatType?: { id: number };
}

export interface Employee {
  id: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumberMobile?: string;
  employeeNumber?: number;
  department?: { id: number; name?: string };
  employments?: Employment[];
  isInactive?: boolean;
}

export interface Employment {
  id: number;
  startDate?: string;
  endDate?: string;
  employmentType?: string;
  percentageOfFullTimeEquivalent?: number;
}

export interface Project {
  id: number;
  name?: string;
  number?: string;
  description?: string;
  projectManager?: { id: number; name?: string };
  customer?: { id: number; name?: string };
  startDate?: string;
  endDate?: string;
  isClosed?: boolean;
  isInternal?: boolean;
}

export interface TimesheetEntry {
  id: number;
  date?: string;
  hours?: number;
  employee?: { id: number; name?: string };
  project?: { id: number; name?: string };
  activity?: { id: number; name?: string };
  comment?: string;
}

export interface Account {
  id: number;
  number?: number;
  name?: string;
  description?: string;
  type?: string;
  vatType?: { id: number };
  isCloseable?: boolean;
  isInactive?: boolean;
}

export interface Voucher {
  id: number;
  date?: string;
  description?: string;
  voucherType?: { id: number; name?: string };
  postings?: Posting[];
}

export interface Posting {
  id?: number;
  account?: { id: number; number?: number };
  amount?: number;
  amountCurrency?: number;
  description?: string;
}

export interface Department {
  id: number;
  name?: string;
  departmentNumber?: string;
  departmentManager?: { id: number };
}

export interface Company {
  id: number;
  name?: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  address?: Address;
}

// ==================== Client Class ====================

export class TripletexClient {
  private sessionToken: string;
  private companyId: string;
  private baseUrl: string;

  constructor(config: TripletexClientConfig) {
    this.sessionToken = config.sessionToken;
    this.companyId = config.companyId;
    this.baseUrl = config.baseUrl || TRIPLETEX_API_URL;
  }

  // ==================== Company ====================

  async getCompany(): Promise<Company> {
    const result = await this.get<Company>(`/company/${this.companyId}`);
    return result.value!;
  }

  // ==================== Customers ====================

  async searchCustomers(params: {
    name?: string;
    organizationNumber?: string;
    customerNumber?: string;
    email?: string;
    isInactive?: boolean;
  } & PaginationParams = {}): Promise<Customer[]> {
    const result = await this.get<Customer>("/customer", {
      ...params,
      isCustomer: true,
    });
    return result.values || [];
  }

  async getCustomer(id: number): Promise<Customer> {
    const result = await this.get<Customer>(`/customer/${id}`);
    return result.value!;
  }

  async createCustomer(data: Partial<Customer>): Promise<Customer> {
    const result = await this.post<Customer>("/customer", {
      ...data,
      isCustomer: true,
    });
    return result.value!;
  }

  async updateCustomer(id: number, data: Partial<Customer>): Promise<Customer> {
    const result = await this.put<Customer>(`/customer/${id}`, data);
    return result.value!;
  }

  // ==================== Suppliers ====================

  async searchSuppliers(params: {
    name?: string;
    organizationNumber?: string;
    supplierNumber?: string;
    email?: string;
    isInactive?: boolean;
  } & PaginationParams = {}): Promise<Supplier[]> {
    const result = await this.get<Supplier>("/supplier", params);
    return result.values || [];
  }

  async getSupplier(id: number): Promise<Supplier> {
    const result = await this.get<Supplier>(`/supplier/${id}`);
    return result.value!;
  }

  async createSupplier(data: Partial<Supplier>): Promise<Supplier> {
    const result = await this.post<Supplier>("/supplier", data);
    return result.value!;
  }

  async updateSupplier(id: number, data: Partial<Supplier>): Promise<Supplier> {
    const result = await this.put<Supplier>(`/supplier/${id}`, data);
    return result.value!;
  }

  // ==================== Products ====================

  async searchProducts(params: {
    name?: string;
    number?: string;
    isInactive?: boolean;
  } & PaginationParams = {}): Promise<Product[]> {
    const result = await this.get<Product>("/product", params);
    return result.values || [];
  }

  async getProduct(id: number): Promise<Product> {
    const result = await this.get<Product>(`/product/${id}`);
    return result.value!;
  }

  async createProduct(data: Partial<Product>): Promise<Product> {
    const result = await this.post<Product>("/product", data);
    return result.value!;
  }

  async updateProduct(id: number, data: Partial<Product>): Promise<Product> {
    const result = await this.put<Product>(`/product/${id}`, data);
    return result.value!;
  }

  // ==================== Invoices ====================

  async searchInvoices(params: {
    invoiceDateFrom?: string;
    invoiceDateTo?: string;
    customerId?: number;
    isPaid?: boolean;
  } & PaginationParams = {}): Promise<Invoice[]> {
    const result = await this.get<Invoice>("/invoice", params);
    return result.values || [];
  }

  async getInvoice(id: number): Promise<Invoice> {
    const result = await this.get<Invoice>(`/invoice/${id}`);
    return result.value!;
  }

  async createInvoice(orderId: number, data: {
    invoiceDate: string;
    sendMethod?: string;
  }): Promise<Invoice> {
    const result = await this.put<Invoice>(`/invoice/${orderId}/:createInvoice`, data);
    return result.value!;
  }

  async sendInvoice(id: number, data: {
    sendType?: string;
    overrideEmailAddress?: string;
  } = {}): Promise<void> {
    await this.put(`/invoice/${id}/:send`, data);
  }

  // ==================== Orders ====================

  async searchOrders(params: {
    orderDateFrom?: string;
    orderDateTo?: string;
    customerId?: number;
    isClosed?: boolean;
  } & PaginationParams = {}): Promise<Order[]> {
    const result = await this.get<Order>("/order", params);
    return result.values || [];
  }

  async getOrder(id: number): Promise<Order> {
    const result = await this.get<Order>(`/order/${id}`);
    return result.value!;
  }

  async createOrder(data: {
    customer: { id: number };
    orderDate: string;
    deliveryDate?: string;
    orderLines?: OrderLine[];
    deliveryAddress?: Address;
  }): Promise<Order> {
    const result = await this.post<Order>("/order", data);
    return result.value!;
  }

  async updateOrder(id: number, data: Partial<Order>): Promise<Order> {
    const result = await this.put<Order>(`/order/${id}`, data);
    return result.value!;
  }

  // ==================== Employees ====================

  async searchEmployees(params: {
    firstName?: string;
    lastName?: string;
    email?: string;
    employeeNumber?: string;
    departmentId?: number;
    includeInactive?: boolean;
  } & PaginationParams = {}): Promise<Employee[]> {
    const result = await this.get<Employee>("/employee", params);
    return result.values || [];
  }

  async getEmployee(id: number): Promise<Employee> {
    const result = await this.get<Employee>(`/employee/${id}`);
    return result.value!;
  }

  async createEmployee(data: Partial<Employee>): Promise<Employee> {
    const result = await this.post<Employee>("/employee", data);
    return result.value!;
  }

  async updateEmployee(id: number, data: Partial<Employee>): Promise<Employee> {
    const result = await this.put<Employee>(`/employee/${id}`, data);
    return result.value!;
  }

  // ==================== Projects ====================

  async searchProjects(params: {
    name?: string;
    number?: string;
    projectManagerId?: number;
    customerId?: number;
    isClosed?: boolean;
  } & PaginationParams = {}): Promise<Project[]> {
    const result = await this.get<Project>("/project", params);
    return result.values || [];
  }

  async getProject(id: number): Promise<Project> {
    const result = await this.get<Project>(`/project/${id}`);
    return result.value!;
  }

  async createProject(data: Partial<Project>): Promise<Project> {
    const result = await this.post<Project>("/project", data);
    return result.value!;
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project> {
    const result = await this.put<Project>(`/project/${id}`, data);
    return result.value!;
  }

  // ==================== Timesheet ====================

  async searchTimesheetEntries(params: {
    dateFrom?: string;
    dateTo?: string;
    employeeId?: number;
    projectId?: number;
  } & PaginationParams = {}): Promise<TimesheetEntry[]> {
    const result = await this.get<TimesheetEntry>("/timesheet/entry", params);
    return result.values || [];
  }

  async getTimesheetEntry(id: number): Promise<TimesheetEntry> {
    const result = await this.get<TimesheetEntry>(`/timesheet/entry/${id}`);
    return result.value!;
  }

  async createTimesheetEntry(data: {
    date: string;
    hours: number;
    employee: { id: number };
    project?: { id: number };
    activity: { id: number };
    comment?: string;
  }): Promise<TimesheetEntry> {
    const result = await this.post<TimesheetEntry>("/timesheet/entry", data);
    return result.value!;
  }

  async updateTimesheetEntry(id: number, data: Partial<TimesheetEntry>): Promise<TimesheetEntry> {
    const result = await this.put<TimesheetEntry>(`/timesheet/entry/${id}`, data);
    return result.value!;
  }

  async deleteTimesheetEntry(id: number): Promise<void> {
    await this.delete(`/timesheet/entry/${id}`);
  }

  // ==================== Accounts (Ledger) ====================

  async searchAccounts(params: {
    number?: string;
    name?: string;
    isInactive?: boolean;
  } & PaginationParams = {}): Promise<Account[]> {
    const result = await this.get<Account>("/ledger/account", params);
    return result.values || [];
  }

  async getAccount(id: number): Promise<Account> {
    const result = await this.get<Account>(`/ledger/account/${id}`);
    return result.value!;
  }

  // ==================== Vouchers ====================

  async searchVouchers(params: {
    dateFrom?: string;
    dateTo?: string;
  } & PaginationParams = {}): Promise<Voucher[]> {
    const result = await this.get<Voucher>("/ledger/voucher", params);
    return result.values || [];
  }

  async getVoucher(id: number): Promise<Voucher> {
    const result = await this.get<Voucher>(`/ledger/voucher/${id}`);
    return result.value!;
  }

  async createVoucher(data: {
    date: string;
    description?: string;
    voucherType?: { id: number };
    postings: Posting[];
  }): Promise<Voucher> {
    const result = await this.post<Voucher>("/ledger/voucher", data);
    return result.value!;
  }

  // ==================== Departments ====================

  async searchDepartments(params: {
    name?: string;
  } & PaginationParams = {}): Promise<Department[]> {
    const result = await this.get<Department>("/department", params);
    return result.values || [];
  }

  async getDepartment(id: number): Promise<Department> {
    const result = await this.get<Department>(`/department/${id}`);
    return result.value!;
  }

  // ==================== Activities ====================

  async searchActivities(params: {
    name?: string;
    isInactive?: boolean;
  } & PaginationParams = {}): Promise<Array<{ id: number; name?: string; number?: string }>> {
    const result = await this.get<{ id: number; name?: string; number?: string }>("/activity", params);
    return result.values || [];
  }

  // ==================== Salary Types ====================

  async searchSalaryTypes(params: {
    name?: string;
    number?: string;
    isInactive?: boolean;
  } & PaginationParams = {}): Promise<Array<{
    id: number;
    number?: string;
    name?: string;
    description?: string;
    showInTimesheet?: boolean;
    isSickPayable?: boolean;
    isVacationPayable?: boolean;
    isTaxable?: boolean;
    isPayrollTaxable?: boolean;
  }>> {
    const result = await this.get<{
      id: number;
      number?: string;
      name?: string;
      description?: string;
      showInTimesheet?: boolean;
      isSickPayable?: boolean;
      isVacationPayable?: boolean;
      isTaxable?: boolean;
      isPayrollTaxable?: boolean;
    }>("/salary/type", params);
    return result.values || [];
  }

  async getSalaryType(id: number): Promise<{
    id: number;
    number?: string;
    name?: string;
    description?: string;
    isTaxable?: boolean;
    isVacationPayable?: boolean;
  }> {
    const result = await this.get<{
      id: number;
      number?: string;
      name?: string;
      description?: string;
      isTaxable?: boolean;
      isVacationPayable?: boolean;
    }>(`/salary/type/${id}`);
    return result.value!;
  }

  // ==================== Salary Transactions ====================

  async searchSalaryTransactions(params: {
    yearFrom?: number;
    yearTo?: number;
    monthFrom?: number;
    monthTo?: number;
  } & PaginationParams = {}): Promise<Array<{
    id: number;
    date?: string;
    year: number;
    month: number;
    payslips?: Array<{ id: number }>;
  }>> {
    const result = await this.get<{
      id: number;
      date?: string;
      year: number;
      month: number;
      payslips?: Array<{ id: number }>;
    }>("/salary/transaction", params);
    return result.values || [];
  }

  async getSalaryTransaction(id: number): Promise<{
    id: number;
    date?: string;
    year: number;
    month: number;
    payslips?: Array<{ id: number }>;
  }> {
    const result = await this.get<{
      id: number;
      date?: string;
      year: number;
      month: number;
      payslips?: Array<{ id: number }>;
    }>(`/salary/transaction/${id}`);
    return result.value!;
  }

  async createSalaryTransaction(data: {
    date: string;
    year: number;
    month: number;
    isHistorical?: boolean;
    paySlipsAvailableDate?: string;
    payslips: Array<{
      employee: { id: number };
      specifications: Array<{
        salaryType: { id: number };
        rate: number;
        count: number;
        amount: number;
        description?: string;
      }>;
    }>;
  }): Promise<{
    id: number;
    date?: string;
    year: number;
    month: number;
  }> {
    const result = await this.post<{
      id: number;
      date?: string;
      year: number;
      month: number;
    }>("/salary/transaction", data);
    return result.value!;
  }

  // ==================== Payslips ====================

  async searchPayslips(params: {
    employeeId?: number;
    yearFrom?: number;
    yearTo?: number;
    monthFrom?: number;
    monthTo?: number;
  } & PaginationParams = {}): Promise<Array<{
    id: number;
    employee?: { id: number; firstName?: string; lastName?: string };
    date?: string;
    year?: number;
    month?: number;
    grossAmount?: number;
    amount?: number;
  }>> {
    const result = await this.get<{
      id: number;
      employee?: { id: number; firstName?: string; lastName?: string };
      date?: string;
      year?: number;
      month?: number;
      grossAmount?: number;
      amount?: number;
    }>("/salary/payslip", params);
    return result.values || [];
  }

  async getPayslip(id: number): Promise<{
    id: number;
    employee?: { id: number; firstName?: string; lastName?: string };
    date?: string;
    year?: number;
    month?: number;
    grossAmount?: number;
    amount?: number;
    vacationAllowanceAmount?: number;
    specifications?: Array<{
      salaryType?: { id: number; name?: string };
      amount?: number;
      rate?: number;
      count?: number;
      description?: string;
    }>;
  }> {
    const result = await this.get<{
      id: number;
      employee?: { id: number; firstName?: string; lastName?: string };
      date?: string;
      year?: number;
      month?: number;
      grossAmount?: number;
      amount?: number;
      vacationAllowanceAmount?: number;
      specifications?: Array<{
        salaryType?: { id: number; name?: string };
        amount?: number;
        rate?: number;
        count?: number;
        description?: string;
      }>;
    }>(`/salary/payslip/${id}`);
    return result.value!;
  }

  // ==================== Employments ====================

  async searchEmployments(params: {
    employeeId?: number;
  } & PaginationParams = {}): Promise<Array<{
    id: number;
    employee?: { id: number };
    startDate?: string;
    endDate?: string;
    division?: { id: number; name?: string };
    isMainEmployer?: boolean;
    taxDeductionCode?: string;
  }>> {
    const result = await this.get<{
      id: number;
      employee?: { id: number };
      startDate?: string;
      endDate?: string;
      division?: { id: number; name?: string };
      isMainEmployer?: boolean;
      taxDeductionCode?: string;
    }>("/employee/employment", params);
    return result.values || [];
  }

  async getEmployment(id: number): Promise<{
    id: number;
    employee?: { id: number };
    startDate?: string;
    endDate?: string;
    division?: { id: number; name?: string };
    isMainEmployer?: boolean;
    employmentDetails?: Array<{
      employmentType?: string;
      employmentForm?: string;
      remunerationType?: string;
      percentageOfFullTimeEquivalent?: number;
      annualSalary?: number;
      hourlyWage?: number;
    }>;
  }> {
    const result = await this.get<{
      id: number;
      employee?: { id: number };
      startDate?: string;
      endDate?: string;
      division?: { id: number; name?: string };
      isMainEmployer?: boolean;
      employmentDetails?: Array<{
        employmentType?: string;
        employmentForm?: string;
        remunerationType?: string;
        percentageOfFullTimeEquivalent?: number;
        annualSalary?: number;
        hourlyWage?: number;
      }>;
    }>(`/employee/employment/${id}`);
    return result.value!;
  }

  async createEmployment(data: {
    employee: { id: number };
    division: { id: number };
    startDate: string;
    endDate?: string;
    isMainEmployer?: boolean;
    taxDeductionCode?: string;
    employmentDetails?: Array<{
      date: string;
      employmentType?: string;
      employmentForm?: string;
      remunerationType?: string;
      percentageOfFullTimeEquivalent?: number;
      annualSalary?: number;
      hourlyWage?: number;
    }>;
  }): Promise<{
    id: number;
    startDate?: string;
    division?: { id: number; name?: string };
  }> {
    const result = await this.post<{
      id: number;
      startDate?: string;
      division?: { id: number; name?: string };
    }>("/employee/employment", data);
    return result.value!;
  }

  // ==================== Divisions ====================

  async searchDivisions(params: {
    query?: string;
  } & PaginationParams = {}): Promise<Array<{
    id: number;
    name?: string;
    displayName?: string;
    organizationNumber?: string;
    startDate?: string;
    endDate?: string;
  }>> {
    const result = await this.get<{
      id: number;
      name?: string;
      displayName?: string;
      organizationNumber?: string;
      startDate?: string;
      endDate?: string;
    }>("/division", params);
    return result.values || [];
  }

  async getDivision(id: number): Promise<{
    id: number;
    name?: string;
    displayName?: string;
    organizationNumber?: string;
    startDate?: string;
    endDate?: string;
    municipality?: { id: number; name?: string; number?: string };
  }> {
    const result = await this.get<{
      id: number;
      name?: string;
      displayName?: string;
      organizationNumber?: string;
      startDate?: string;
      endDate?: string;
      municipality?: { id: number; name?: string; number?: string };
    }>(`/division/${id}`);
    return result.value!;
  }

  // ==================== HTTP Methods ====================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async get<T>(
    path: string,
    params: any = {}
  ): Promise<TripletexResponse<T>> {
    return this.request<T>("GET", path, { queryParams: params });
  }

  private async post<T>(
    path: string,
    body: unknown
  ): Promise<TripletexResponse<T>> {
    return this.request<T>("POST", path, { body });
  }

  private async put<T>(
    path: string,
    body?: unknown
  ): Promise<TripletexResponse<T>> {
    return this.request<T>("PUT", path, { body });
  }

  private async delete(path: string): Promise<void> {
    await this.request("DELETE", path);
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      queryParams?: Record<string, unknown>;
      body?: unknown;
    } = {}
  ): Promise<TripletexResponse<T>> {
    let url = `${this.baseUrl}${path}`;

    // Build query string
    if (options.queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.queryParams)) {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += (url.includes("?") ? "&" : "?") + queryString;
      }
    }

    console.log(`[Tripletex API] ${method} ${url}`);

    const authHeader = `Basic ${Buffer.from(`0:${this.sessionToken}`).toString("base64")}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Tripletex API] Error: ${response.status} - ${error}`);
      throw new Error(`Tripletex API error: ${response.status} - ${error}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as TripletexResponse<T>;
    }

    const result = await response.json();
    return result;
  }
}

// ==================== Factory Function ====================

export function createTripletexClient(
  sessionToken: string,
  companyId: string
): TripletexClient {
  return new TripletexClient({ sessionToken, companyId });
}

export default TripletexClient;
