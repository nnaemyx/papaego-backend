
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  role: 'role',
  email: 'email',
  phone: 'phone',
  password: 'password',
  firstName: 'firstName',
  lastName: 'lastName',
  isActive: 'isActive',
  createdAt: 'createdAt'
};

exports.Prisma.NotificationScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  title: 'title',
  message: 'message',
  type: 'type',
  isRead: 'isRead',
  createdAt: 'createdAt'
};

exports.Prisma.CountryScalarFieldEnum = {
  id: 'id',
  name: 'name',
  isoCode: 'isoCode',
  currency: 'currency'
};

exports.Prisma.AgentProfileScalarFieldEnum = {
  userId: 'userId',
  region: 'region',
  lga: 'lga',
  licenseId: 'licenseId',
  dailyLimit: 'dailyLimit',
  monthlyLimit: 'monthlyLimit',
  homeAddress: 'homeAddress',
  dateOfBirth: 'dateOfBirth',
  governmentIdUrl: 'governmentIdUrl',
  proofOfAddressUrl: 'proofOfAddressUrl',
  onboardingStatus: 'onboardingStatus',
  onboardingToken: 'onboardingToken',
  onboardingTokenExpiry: 'onboardingTokenExpiry'
};

exports.Prisma.CustomerScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  bvn: 'bvn',
  fullName: 'fullName',
  bankName: 'bankName',
  accountNo: 'accountNo',
  email: 'email',
  phone: 'phone',
  gender: 'gender',
  dateOfBirth: 'dateOfBirth',
  homeAddress: 'homeAddress',
  nin: 'nin',
  companyName: 'companyName',
  companySector: 'companySector',
  governmentIdUrl: 'governmentIdUrl',
  proofOfAddressUrl: 'proofOfAddressUrl',
  verified: 'verified',
  createdAt: 'createdAt'
};

exports.Prisma.CustomerBankDetailsScalarFieldEnum = {
  id: 'id',
  customerId: 'customerId',
  bankName: 'bankName',
  accountName: 'accountName',
  accountNumber: 'accountNumber',
  routingNumber: 'routingNumber',
  swiftCode: 'swiftCode',
  createdAt: 'createdAt'
};

exports.Prisma.TradeRequestScalarFieldEnum = {
  id: 'id',
  customerId: 'customerId',
  agentId: 'agentId',
  amount: 'amount',
  sendCurrency: 'sendCurrency',
  receiveCurrency: 'receiveCurrency',
  purpose: 'purpose',
  tradeType: 'tradeType',
  receiptUrl: 'receiptUrl',
  status: 'status',
  createdAt: 'createdAt'
};

exports.Prisma.ChatMessageScalarFieldEnum = {
  id: 'id',
  tradeId: 'tradeId',
  senderId: 'senderId',
  message: 'message',
  role: 'role',
  createdAt: 'createdAt'
};

exports.Prisma.CustomerDocumentScalarFieldEnum = {
  id: 'id',
  customerId: 'customerId',
  agentId: 'agentId',
  documentType: 'documentType',
  fileUrl: 'fileUrl',
  fileName: 'fileName',
  fileSize: 'fileSize',
  status: 'status',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TradeScalarFieldEnum = {
  id: 'id',
  agentId: 'agentId',
  customerId: 'customerId',
  countryId: 'countryId',
  tradeType: 'tradeType',
  sendCurrency: 'sendCurrency',
  receiveCurrency: 'receiveCurrency',
  amount: 'amount',
  fxRate: 'fxRate',
  lockedUntil: 'lockedUntil',
  status: 'status',
  createdAt: 'createdAt',
  paymentMethod: 'paymentMethod',
  paymentSource: 'paymentSource',
  payoutMethod: 'payoutMethod',
  recipientName: 'recipientName',
  recipientDetails: 'recipientDetails',
  payoutAmount: 'payoutAmount',
  paymentProofUrl: 'paymentProofUrl',
  payoutProofUrl: 'payoutProofUrl',
  isCommissionFrozen: 'isCommissionFrozen'
};

exports.Prisma.ComplianceFlagScalarFieldEnum = {
  id: 'id',
  tradeId: 'tradeId',
  reason: 'reason',
  severity: 'severity',
  createdAt: 'createdAt'
};

exports.Prisma.ComplianceReportScalarFieldEnum = {
  id: 'id',
  tradeId: 'tradeId',
  type: 'type',
  data: 'data',
  createdAt: 'createdAt'
};

exports.Prisma.OverrideApprovalScalarFieldEnum = {
  id: 'id',
  tradeId: 'tradeId',
  requestedBy: 'requestedBy',
  approvedBy: 'approvedBy',
  status: 'status'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  actorId: 'actorId',
  role: 'role',
  action: 'action',
  entity: 'entity',
  entityId: 'entityId',
  ip: 'ip',
  createdAt: 'createdAt'
};

exports.Prisma.FxMarginScalarFieldEnum = {
  id: 'id',
  countryId: 'countryId',
  margin: 'margin'
};

exports.Prisma.SystemConfigScalarFieldEnum = {
  key: 'key',
  value: 'value'
};

exports.Prisma.CommissionScalarFieldEnum = {
  id: 'id',
  reference: 'reference',
  agentId: 'agentId',
  tradeId: 'tradeId',
  type: 'type',
  amount: 'amount',
  currency: 'currency',
  rate: 'rate',
  status: 'status',
  paidAt: 'paidAt',
  payoutMethod: 'payoutMethod',
  bankName: 'bankName',
  accountName: 'accountName',
  accountNumber: 'accountNumber',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CommissionActivityScalarFieldEnum = {
  id: 'id',
  commissionId: 'commissionId',
  action: 'action',
  actorId: 'actorId',
  description: 'description',
  createdAt: 'createdAt'
};

exports.Prisma.CustomerNoteScalarFieldEnum = {
  id: 'id',
  customerId: 'customerId',
  agentId: 'agentId',
  content: 'content',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.Role = exports.$Enums.Role = {
  AGENT: 'AGENT',
  CUSTOMER: 'CUSTOMER',
  COMPLIANCE: 'COMPLIANCE',
  ADMIN: 'ADMIN'
};

exports.TradeStatus = exports.$Enums.TradeStatus = {
  REQUESTED: 'REQUESTED',
  INITIATED: 'INITIATED',
  CUSTOMER_VERIFIED: 'CUSTOMER_VERIFIED',
  QUOTED: 'QUOTED',
  SENT_TO_CUSTOMER: 'SENT_TO_CUSTOMER',
  CUSTOMER_CONFIRMED: 'CUSTOMER_CONFIRMED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  FLAGGED: 'FLAGGED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
};

exports.ReportType = exports.$Enums.ReportType = {
  CTR: 'CTR',
  STR: 'STR'
};

exports.ApprovalStatus = exports.$Enums.ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

exports.CommissionType = exports.$Enums.CommissionType = {
  TRANSACTION: 'TRANSACTION',
  REFERRAL: 'REFERRAL',
  BONUS: 'BONUS'
};

exports.CommissionStatus = exports.$Enums.CommissionStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  DISPUTED: 'DISPUTED'
};

exports.Prisma.ModelName = {
  User: 'User',
  Notification: 'Notification',
  Country: 'Country',
  AgentProfile: 'AgentProfile',
  Customer: 'Customer',
  CustomerBankDetails: 'CustomerBankDetails',
  TradeRequest: 'TradeRequest',
  ChatMessage: 'ChatMessage',
  CustomerDocument: 'CustomerDocument',
  Trade: 'Trade',
  ComplianceFlag: 'ComplianceFlag',
  ComplianceReport: 'ComplianceReport',
  OverrideApproval: 'OverrideApproval',
  AuditLog: 'AuditLog',
  FxMargin: 'FxMargin',
  SystemConfig: 'SystemConfig',
  Commission: 'Commission',
  CommissionActivity: 'CommissionActivity',
  CustomerNote: 'CustomerNote'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
