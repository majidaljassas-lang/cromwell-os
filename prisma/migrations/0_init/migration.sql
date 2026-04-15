-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TicketMode" AS ENUM ('DIRECT_ORDER', 'PRICING_FIRST', 'SPEC_DRIVEN', 'COMPETITIVE_BID', 'RECOVERY', 'CASH_SALE', 'LABOUR_ONLY', 'PROJECT_WORK', 'NON_SITE');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('CAPTURED', 'PRICING', 'QUOTED', 'APPROVED', 'ORDERED', 'DELIVERED', 'COSTED', 'PENDING_PO', 'RECOVERY', 'VERIFIED', 'LOCKED', 'INVOICED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketLineType" AS ENUM ('MATERIAL', 'LABOUR', 'PLANT', 'SERVICE', 'DELIVERY', 'CASH_SALE', 'RETURN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('EA', 'M', 'LENGTH', 'PACK', 'LOT', 'SET');

-- CreateEnum
CREATE TYPE "TicketLineStatus" AS ENUM ('RAW', 'MERGED', 'CAPTURED', 'PRICED', 'READY_FOR_QUOTE', 'PARTIALLY_ORDERED', 'ORDERED', 'PARTIALLY_COSTED', 'FULLY_COSTED', 'INVOICED', 'RETURNED', 'DISPUTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW_ENQUIRY', 'OPEN', 'IN_REVIEW', 'AWAITING_SITE', 'AWAITING_CUSTOMER', 'PRICING', 'QUOTE_SENT', 'AWAITING_RESPONSE', 'READY_FOR_TICKET', 'READY_TO_CONVERT', 'CONVERTED', 'CLOSED_LOST', 'CLOSED_NO_ACTION');

-- CreateEnum
CREATE TYPE "CustomerPOType" AS ENUM ('STANDARD_FIXED', 'DRAWDOWN_LABOUR', 'DRAWDOWN_MATERIALS');

-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('OPEN', 'EVIDENCE_BUILDING', 'PACK_READY', 'PACK_SENT_FOR_PO', 'AWAITING_PO', 'PO_RECEIVED', 'PO_MISMATCH', 'PO_ALLOCATED', 'INVOICE_READY', 'INVOICE_SENT', 'PAYMENT_PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "CostClassification" AS ENUM ('BILLABLE', 'ABSORBED', 'REALLOCATABLE', 'STOCK', 'MOQ_EXCESS', 'WRITE_OFF', 'CREDIT');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('INSTRUCTION', 'APPROVAL', 'PRICING', 'DELIVERY', 'DISPUTE', 'PO_REQUEST', 'PO_RECEIVED', 'SUPPLIER_CONFIRMATION', 'PHOTO', 'CALL_NOTE');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('WHATSAPP', 'OUTLOOK', 'ZOHO_BOOKS', 'EMAIL', 'PDF_UPLOAD', 'IMAGE_UPLOAD', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "EnquiryType" AS ENUM ('DIRECT_ORDER', 'QUOTE_REQUEST', 'PRICING_FIRST', 'SPEC_REQUEST', 'COMPETITIVE_BID', 'APPROVAL', 'FOLLOW_UP', 'DELIVERY_UPDATE', 'DISPUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('MATCHED', 'PARTIAL', 'SUGGESTED', 'EXCEPTION', 'UNALLOCATED');

-- CreateEnum
CREATE TYPE "BundleType" AS ENUM ('SINGLE_ITEM', 'GROUPED_MATERIALS', 'LABOUR_BUNDLE', 'MIXED_SCOPE');

-- CreateEnum
CREATE TYPE "BundlePricingMode" AS ENUM ('COST_PLUS', 'MANUAL_FIXED', 'BENCHMARK_MATCHED', 'STRATEGIC');

-- CreateEnum
CREATE TYPE "DrawdownDayType" AS ENUM ('WEEKDAY', 'WEEKEND', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ENQUIRY_LOGGED', 'QUOTE_REQUESTED', 'QUOTE_SENT', 'QUOTE_APPROVED', 'PO_REQUESTED', 'PO_RECEIVED', 'PURCHASE_ORDER_SENT', 'SUPPLIER_CONFIRMED', 'GOODS_DELIVERED', 'BILL_RECEIVED', 'INVOICE_RAISED', 'PAYMENT_RECEIVED', 'RETURN_CREATED', 'CREDIT_RECEIVED', 'RECOVERY_TRIGGERED', 'EVIDENCE_PACK_GENERATED', 'TASK_GENERATED', 'PACK_SENT_FOR_PO', 'PO_FOLLOWUP_SENT', 'INVOICE_UNLOCKED');

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('INITIAL_ORDER', 'ADDITION', 'REDUCTION', 'SUBSTITUTION_OUT', 'SUBSTITUTION_IN', 'CANCELLATION', 'CONFIRMATION', 'QUERY_ONLY');

-- CreateEnum
CREATE TYPE "FulfilmentType" AS ENUM ('DELIVERED', 'PART_DELIVERED', 'SUBSTITUTED', 'RETURNED', 'CREDITED');

-- CreateEnum
CREATE TYPE "ZohoInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'OVERDUE', 'PAID', 'PART_PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceLineAllocStatus" AS ENUM ('UNALLOCATED', 'PARTIALLY_ALLOCATED', 'ALLOCATED');

-- CreateEnum
CREATE TYPE "OrderClosureStatus" AS ENUM ('OPEN', 'PARTIALLY_BILLED', 'BILLED_NOT_SENT', 'SENT_AWAITING_PAYMENT', 'PART_PAID_CLOSURE', 'CLOSED', 'REVIEW_REQUIRED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "OrderFulfilmentStatus" AS ENUM ('UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'OVER_FULFILLED', 'REVIEW_REQUIRED_FULFILMENT');

-- CreateEnum
CREATE TYPE "OrderBillingStatus" AS ENUM ('UNBILLED', 'PARTIALLY_BILLED_STATUS', 'BILLED', 'OVERBILLED', 'REVIEW_REQUIRED_BILLING');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('COMPLETE', 'UNDERBILLED', 'OVERBILLED', 'OVER_SUPPLIED', 'OVER_SUPPLIED_UNDERBILLED', 'AWAITING_INVOICE', 'SATISFIED_BY_SUBSTITUTION', 'REVIEW_REQUIRED_RECON');

-- CreateEnum
CREATE TYPE "CostLinkStatus" AS ENUM ('NO_COST_LINKED', 'PARTIALLY_LINKED', 'FULLY_LINKED', 'NEGATIVE_MARGIN', 'LOW_MARGIN');

-- CreateEnum
CREATE TYPE "ReviewQueueType" AS ENUM ('UNRESOLVED_SITE', 'UNRESOLVED_PRODUCT', 'UOM_MISMATCH', 'UNALLOCATED_INVOICE_LINE', 'MISSING_ORDER_EVIDENCE', 'SUBSTITUTION_NO_EVIDENCE', 'NEGATIVE_MARGIN_REVIEW', 'MEDIA_PENDING');

-- CreateEnum
CREATE TYPE "ReviewQueueStatus" AS ENUM ('OPEN_REVIEW', 'IN_PROGRESS_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'PDF', 'DOCUMENT', 'VOICE_NOTE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaEvidenceRole" AS ENUM ('ORDER_EVIDENCE', 'DELIVERY_EVIDENCE', 'INVOICE_EVIDENCE', 'PRODUCT_REFERENCE', 'IRRELEVANT', 'UNKNOWN_MEDIA');

-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PENDING', 'EXTRACTING', 'EXTRACTED', 'CLASSIFIED', 'LINKED', 'FAILED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "MediaConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "OrderEventSource" AS ENUM ('TEXT_MESSAGE', 'MEDIA_OCR', 'VOICE_TRANSCRIPT', 'MEDIA_EXTRACTION', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "SourceConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SiteConfidence" AS ENUM ('CONFIRMED', 'PROBABLE', 'UNKNOWN_SITE', 'NOT_THIS_SITE');

-- CreateEnum
CREATE TYPE "ContaminationRisk" AS ENUM ('LOW_RISK', 'MEDIUM_RISK', 'HIGH_RISK');

-- CreateEnum
CREATE TYPE "OrderGroupApproval" AS ENUM ('AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "InboundLinkStatus" AS ENUM ('LINKED_HIGH', 'LINKED_MEDIUM', 'NEEDS_REVIEW', 'NEW_ENQUIRY_CANDIDATE', 'UNPROCESSED');

-- CreateEnum
CREATE TYPE "InboundEventType" AS ENUM ('WHATSAPP_MESSAGE', 'EMAIL', 'VOICE_NOTE', 'ATTACHMENT', 'MEDIA_IMAGE', 'MEDIA_PDF', 'MEDIA_DOCUMENT', 'PHONE_CALL', 'MANUAL_NOTE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ParentJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "primarySiteId" TEXT,
    "status" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "expectedTotalSell" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedTotalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actualTotalSell" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actualTotalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedMargin" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actualMargin" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "siteCode" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "postcode" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "billingAddress" TEXT,
    "vatNumber" TEXT,
    "paymentTerms" TEXT,
    "defaultCustomerMode" TEXT,
    "poRequiredDefault" BOOLEAN NOT NULL DEFAULT false,
    "isCashCustomer" BOOLEAN NOT NULL DEFAULT false,
    "commercialGroupId" TEXT,
    "parentCustomerEntityId" TEXT,
    "entityType" TEXT,
    "isBillingEntity" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pricingLocked" BOOLEAN NOT NULL DEFAULT false,
    "defaultMarginPct" DECIMAL(6,3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteCommercialLink" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "billingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "defaultBillingCustomer" BOOLEAN NOT NULL DEFAULT false,
    "commercialNotes" TEXT,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteCommercialLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteContactLink" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "customerId" TEXT,
    "siteCommercialLinkId" TEXT,
    "roleOnSite" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContactLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionSource" (
    "id" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "externalRef" TEXT,
    "connectedAccount" TEXT,
    "accountName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isHistoricalCapable" BOOLEAN NOT NULL DEFAULT false,
    "connectorStatus" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionEvent" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "sourceRecordType" TEXT,
    "eventKind" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParsedMessage" (
    "id" TEXT NOT NULL,
    "ingestionEventId" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "structuredData" JSONB,
    "messageType" TEXT NOT NULL,
    "confidenceScore" DECIMAL(5,2),
    "parseVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParsedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedEntity" (
    "id" TEXT NOT NULL,
    "parsedMessageId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "confidenceScore" DECIMAL(5,2),
    "spanStart" INTEGER,
    "spanEnd" INTEGER,

    CONSTRAINT "ExtractedEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionLink" (
    "id" TEXT NOT NULL,
    "parsedMessageId" TEXT NOT NULL,
    "enquiryId" TEXT,
    "ticketId" TEXT,
    "evidenceFragmentId" TEXT,
    "inquiryWorkItemId" TEXT,
    "supplierBillId" TEXT,
    "supplierBillLineId" TEXT,
    "eventId" TEXT,
    "linkConfidence" DECIMAL(5,2),
    "linkStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "parentJobId" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "channelThreadRef" TEXT,
    "sourceContactId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "subjectOrLabel" TEXT,
    "rawText" TEXT NOT NULL,
    "suggestedSiteId" TEXT,
    "suggestedCustomerId" TEXT,
    "suggestedSiteCommercialLinkId" TEXT,
    "enquiryType" "EnquiryType" NOT NULL,
    "confidenceScore" DECIMAL(5,2),
    "status" TEXT NOT NULL,
    "discardReason" TEXT,
    "discardedBy" TEXT,
    "discardedAt" TIMESTAMP(3),
    "benchmarkPriceRaw" DECIMAL(14,2),
    "benchmarkPriceBasis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryTask" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedTo" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryWorkItem" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "parentJobId" TEXT,
    "siteId" TEXT,
    "siteCommercialLinkId" TEXT,
    "customerId" TEXT,
    "requestedByContactId" TEXT,
    "mode" "TicketMode" NOT NULL,
    "status" "InquiryStatus" NOT NULL,
    "confidenceScore" DECIMAL(5,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InquiryWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "parentJobId" TEXT,
    "siteId" TEXT,
    "siteCommercialLinkId" TEXT,
    "payingCustomerId" TEXT NOT NULL,
    "requestedByContactId" TEXT,
    "actingOnBehalfOfContactId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ticketMode" "TicketMode" NOT NULL,
    "scopeType" TEXT,
    "status" "TicketStatus" NOT NULL,
    "quoteRequired" BOOLEAN NOT NULL DEFAULT false,
    "quoteStatus" TEXT,
    "poRequired" BOOLEAN NOT NULL DEFAULT false,
    "poStatus" TEXT,
    "recoveryRequired" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketPhase" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "phaseName" TEXT NOT NULL,
    "phaseType" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketLine" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketPhaseId" TEXT,
    "lineType" "TicketLineType" NOT NULL,
    "description" TEXT NOT NULL,
    "normalizedItemName" TEXT,
    "productCode" TEXT,
    "specification" TEXT,
    "internalNotes" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'EA',
    "siteId" TEXT,
    "siteCommercialLinkId" TEXT,
    "payingCustomerId" TEXT NOT NULL,
    "requestedByContactId" TEXT,
    "supplierStrategyType" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "supplierReference" TEXT,
    "status" "TicketLineStatus" NOT NULL DEFAULT 'CAPTURED',
    "expectedCostUnit" DECIMAL(14,4),
    "expectedCostTotal" DECIMAL(14,2),
    "actualCostTotal" DECIMAL(14,2),
    "benchmarkUnit" DECIMAL(14,4),
    "benchmarkTotal" DECIMAL(14,2),
    "suggestedSaleUnit" DECIMAL(14,4),
    "actualSaleUnit" DECIMAL(14,4),
    "actualSaleTotal" DECIMAL(14,2),
    "expectedMarginTotal" DECIMAL(14,2),
    "actualMarginTotal" DECIMAL(14,2),
    "varianceTotal" DECIMAL(14,2),
    "evidenceStatus" TEXT,
    "costStatus" TEXT,
    "salesStatus" TEXT,
    "mergedIntoLineId" TEXT,
    "sourceItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBundle" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bundleType" "BundleType" NOT NULL,
    "pricingMode" "BundlePricingMode" NOT NULL,
    "targetSellTotal" DECIMAL(14,2),
    "actualSellTotal" DECIMAL(14,2),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesBundleCostLink" (
    "id" TEXT NOT NULL,
    "salesBundleId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "linkedCostValue" DECIMAL(14,2),
    "linkedQty" DECIMAL(14,4),
    "contributionType" TEXT NOT NULL,

    CONSTRAINT "SalesBundleCostLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealSheet" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "benchmarkContext" TEXT,
    "strategyNotes" TEXT,
    "totalExpectedCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalExpectedSell" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalExpectedMargin" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalActualCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalActualSell" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalActualMargin" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "varianceTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealSheetLineSnapshot" (
    "id" TEXT NOT NULL,
    "dealSheetId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "supplierSourceSummary" TEXT,
    "benchmarkUnit" DECIMAL(14,4),
    "expectedCostUnit" DECIMAL(14,4),
    "suggestedSaleUnit" DECIMAL(14,4),
    "actualSaleUnit" DECIMAL(14,4),
    "expectedMarginUnit" DECIMAL(14,4),
    "notes" TEXT,

    CONSTRAINT "DealSheetLineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Benchmark" (
    "id" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "benchmarkSource" TEXT NOT NULL,
    "sourceRef" TEXT,
    "unitPrice" DECIMAL(14,4),
    "qty" DECIMAL(14,4),
    "totalPrice" DECIMAL(14,2),
    "capturedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "Benchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompSheet" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "CompSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompSheetLine" (
    "id" TEXT NOT NULL,
    "compSheetId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "benchmarkTotal" DECIMAL(14,2),
    "ourCostTotal" DECIMAL(14,2),
    "ourSaleTotal" DECIMAL(14,2),
    "savingTotal" DECIMAL(14,2),
    "marginTotal" DECIMAL(14,2),
    "notes" TEXT,

    CONSTRAINT "CompSheetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketPhaseId" TEXT,
    "quoteNo" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "quoteType" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "siteCommercialLinkId" TEXT,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "totalSell" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "pdfFileName" TEXT,
    "pdfPath" TEXT,
    "pdfGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOption" (
    "id" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "costUnit" DECIMAL(14,4) NOT NULL,
    "qtyAvailable" DECIMAL(14,4),
    "leadTimeDays" INTEGER,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "SupplierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementOrder" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "supplierRef" TEXT,
    "issuedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "siteRef" TEXT,
    "deliveryDateExpected" TIMESTAMP(3),
    "totalCostExpected" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ProcurementOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementOrderLine" (
    "id" TEXT NOT NULL,
    "procurementOrderId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "supplierOptionId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ProcurementOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBill" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "siteRef" TEXT,
    "customerRef" TEXT,
    "status" TEXT NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "sourceAttachmentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBillLine" (
    "id" TEXT NOT NULL,
    "supplierBillId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "normalizedItemName" TEXT,
    "productCode" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "siteId" TEXT,
    "siteCommercialLinkId" TEXT,
    "customerId" TEXT,
    "ticketId" TEXT,
    "costClassification" "CostClassification" NOT NULL DEFAULT 'BILLABLE',
    "allocationStatus" "AllocationStatus" NOT NULL,
    "sourceAmountBasis" TEXT,
    "amountExVat" DECIMAL(14,2),
    "vatAmount" DECIMAL(14,2),
    "amountIncVat" DECIMAL(14,2),
    "vatRate" DECIMAL(5,2),
    "vatStatus" TEXT,
    "commercialStatus" TEXT,
    "sourceSiteTextRaw" TEXT,
    "sourceCustomerTextRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "supplierBillLineId" TEXT,
    "procurementOrderLineId" TEXT,
    "supplierId" TEXT NOT NULL,
    "qtyAllocated" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "allocationStatus" "AllocationStatus" NOT NULL,
    "confidenceScore" DECIMAL(5,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPO" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "siteCommercialLinkId" TEXT,
    "poNo" TEXT NOT NULL,
    "poType" "CustomerPOType" NOT NULL,
    "poDate" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "totalValue" DECIMAL(14,2),
    "poLimitValue" DECIMAL(14,2),
    "poCommittedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "poConsumedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "poRemainingValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overheadPct" DECIMAL(6,3),
    "overheadBasis" TEXT,
    "weekdaySellRate" DECIMAL(14,2),
    "weekendSellRate" DECIMAL(14,2),
    "weekdayCostRate" DECIMAL(14,2),
    "weekendCostRate" DECIMAL(14,2),
    "profitToDate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedProfitRemaining" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sourceAttachmentRef" TEXT,
    "sourceAmountBasis" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPOLine" (
    "id" TEXT NOT NULL,
    "customerPOId" TEXT NOT NULL,
    "ticketLineId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,4),
    "agreedUnitPrice" DECIMAL(14,4),
    "agreedTotal" DECIMAL(14,2),
    "consumedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "consumedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remainingQty" DECIMAL(14,4),
    "remainingValue" DECIMAL(14,2),

    CONSTRAINT "CustomerPOLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPOAllocation" (
    "id" TEXT NOT NULL,
    "customerPOId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "salesInvoiceId" TEXT,
    "allocatedValue" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "CustomerPOAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabourDrawdownEntry" (
    "id" TEXT NOT NULL,
    "customerPOId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "weekEndingDate" TIMESTAMP(3),
    "workDate" TIMESTAMP(3) NOT NULL,
    "plumberContactId" TEXT,
    "dayType" "DrawdownDayType" NOT NULL,
    "plumberCount" INTEGER NOT NULL,
    "daysWorked" DECIMAL(8,2) NOT NULL,
    "billableDayRate" DECIMAL(14,2) NOT NULL,
    "billableValue" DECIMAL(14,2) NOT NULL,
    "internalDayCost" DECIMAL(14,2) NOT NULL,
    "internalCostValue" DECIMAL(14,2) NOT NULL,
    "overheadPct" DECIMAL(6,3),
    "overheadValue" DECIMAL(14,2),
    "grossProfitValue" DECIMAL(14,2),
    "invoiceLineId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabourDrawdownEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialsDrawdownEntry" (
    "id" TEXT NOT NULL,
    "customerPOId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketLineId" TEXT,
    "drawdownDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,4),
    "unitSell" DECIMAL(14,4),
    "sellValue" DECIMAL(14,2),
    "unitCostExpected" DECIMAL(14,4),
    "costValueActual" DECIMAL(14,2),
    "overheadPct" DECIMAL(6,3),
    "overheadValue" DECIMAL(14,2),
    "grossProfitValue" DECIMAL(14,2),
    "invoiceLineId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialsDrawdownEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoice" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "siteCommercialLinkId" TEXT,
    "poNo" TEXT,
    "invoiceType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "totalSell" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoiceLine" (
    "id" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "displayMode" TEXT NOT NULL,
    "poMatched" BOOLEAN NOT NULL DEFAULT false,
    "poMatchStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFragment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketLineId" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "sourceRef" TEXT,
    "sourceContactId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "fragmentType" "EvidenceType" NOT NULL,
    "fragmentText" TEXT,
    "attachmentUrl" TEXT,
    "confidenceScore" DECIMAL(5,2),
    "isPrimaryEvidence" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceFragment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketLineId" TEXT,
    "eventType" "EventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "sourceRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketLineId" TEXT,
    "taskType" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "generatedReason" TEXT,
    "dueAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCase" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "reasonType" TEXT NOT NULL,
    "recoveryStatus" "RecoveryStatus" NOT NULL,
    "currentStageStartedAt" TIMESTAMP(3),
    "packSentAt" TIMESTAMP(3),
    "poRequestedAt" TIMESTAMP(3),
    "poReceivedAt" TIMESTAMP(3),
    "invoiceUnlockedAt" TIMESTAMP(3),
    "invoiceSentAt" TIMESTAMP(3),
    "nextAction" TEXT,
    "stuckValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePack" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "recoveryCaseId" TEXT,
    "packType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidencePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePackItem" (
    "id" TEXT NOT NULL,
    "evidencePackId" TEXT NOT NULL,
    "evidenceFragmentId" TEXT,
    "eventId" TEXT,
    "documentRef" TEXT,
    "summaryText" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "EvidencePackItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "siteId" TEXT,
    "eventType" TEXT NOT NULL,
    "contactId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "costTotal" DECIMAL(14,2),
    "notes" TEXT,
    "attachmentRef" TEXT,

    CONSTRAINT "LogisticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Return" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "supplierBillLineId" TEXT,
    "ticketLineId" TEXT NOT NULL,
    "qtyReturned" DECIMAL(14,4) NOT NULL,
    "expectedCredit" DECIMAL(14,2),
    "actualCredit" DECIMAL(14,2),
    "status" TEXT NOT NULL,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "dateReceived" TIMESTAMP(3) NOT NULL,
    "totalCredit" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "sourceAttachmentRef" TEXT,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteAllocation" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "returnLineId" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "allocatedCredit" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CreditNoteAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsorbedCostAllocation" (
    "id" TEXT NOT NULL,
    "supplierBillLineId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketLineId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocationBasis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsorbedCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockExcessRecord" (
    "id" TEXT NOT NULL,
    "supplierBillLineId" TEXT NOT NULL,
    "ticketLineId" TEXT,
    "purchasedCost" DECIMAL(14,2) NOT NULL,
    "usedCost" DECIMAL(14,2) NOT NULL,
    "excessCost" DECIMAL(14,2) NOT NULL,
    "treatment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockExcessRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReallocationRecord" (
    "id" TEXT NOT NULL,
    "fromTicketLineId" TEXT NOT NULL,
    "toTicketLineId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReallocationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabourEntry" (
    "id" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "labourType" TEXT NOT NULL,
    "qtyDaysOrHours" DECIMAL(10,2),
    "costTotal" DECIMAL(14,2),
    "sellTotal" DECIMAL(14,2),
    "notes" TEXT,

    CONSTRAINT "LabourEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSale" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "receivedAmount" DECIMAL(14,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "receiptRef" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePack" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "packDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "summaryNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePackItem" (
    "id" TEXT NOT NULL,
    "sitePackId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "salesInvoiceId" TEXT,
    "evidencePackId" TEXT,
    "status" TEXT NOT NULL,

    CONSTRAINT "SitePackItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAlias" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "aliasText" TEXT NOT NULL,
    "sourceType" "SourceType",
    "aliasSource" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confidenceDefault" DECIMAL(5,2),
    "manualConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAlias" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "aliasText" TEXT NOT NULL,
    "sourceType" "SourceType",
    "aliasSource" TEXT,
    "confidenceScore" DECIMAL(5,2),
    "manualConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualLinkAudit" (
    "id" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "linkedBy" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousState" TEXT,
    "notes" TEXT,

    CONSTRAINT "ManualLinkAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSiteMatch" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "ingestionEventId" TEXT,
    "rawSiteText" TEXT NOT NULL,
    "matchedSiteId" TEXT,
    "matchMethod" TEXT,
    "confidenceScore" DECIMAL(5,2),
    "reviewStatus" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSiteMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftInvoiceRecoveryItem" (
    "id" TEXT NOT NULL,
    "zohoInvoiceExternalId" TEXT,
    "ingestionEventId" TEXT,
    "customerId" TEXT,
    "siteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT_IMPORTED',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceInvoiceJson" JSONB,
    "totalValue" DECIMAL(14,2),
    "issuesSummary" TEXT,
    "outcomeInvoiceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftInvoiceRecoveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionAuditLog" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actor" TEXT,
    "previousValueJson" JSONB,
    "newValueJson" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconstructionBatch" (
    "id" TEXT NOT NULL,
    "monthYear" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "billsFound" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "unmatched" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconstructionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionBatch" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "enquiryId" TEXT,
    "sourceText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedLineCandidate" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "extractedQty" DECIMAL(14,4),
    "extractedUnit" TEXT,
    "extractedProduct" TEXT,
    "extractedSize" TEXT,
    "extractedSpec" TEXT,
    "suggestedLineType" TEXT,
    "confidence" DECIMAL(5,2),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "groupLabel" TEXT,
    "mergedIntoId" TEXT,
    "resultTicketLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedLineCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogCase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "siteId" TEXT,
    "siteRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacklogCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogSourceGroup" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklogSourceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogSource" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "participantList" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawFileRef" TEXT,
    "rawImportText" TEXT,
    "rawImportFilename" TEXT,
    "importBytes" INTEGER NOT NULL DEFAULT 0,
    "importLineCount" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3),
    "importStartedAt" TIMESTAMP(3),
    "importCompletedAt" TIMESTAMP(3),
    "parsedAt" TIMESTAMP(3),
    "parseStatus" TEXT NOT NULL DEFAULT 'NOT_RUN',
    "parseProgressPct" INTEGER NOT NULL DEFAULT 0,
    "unparsedLines" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklogSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogMessage" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "rawTimestampText" TEXT,
    "parsedTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timestampConfidence" TEXT NOT NULL DEFAULT 'HIGH',
    "sender" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "parsedOk" BOOLEAN NOT NULL DEFAULT true,
    "isMultiline" BOOLEAN NOT NULL DEFAULT false,
    "lineCount" INTEGER NOT NULL DEFAULT 1,
    "messageType" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "attachmentRef" TEXT,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "mediaType" TEXT,
    "mediaFilename" TEXT,
    "mediaNote" TEXT,
    "relationType" TEXT NOT NULL DEFAULT 'NONE',
    "relatedMessageId" TEXT,
    "duplicateGroupId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklogMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogOrderThread" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "messageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacklogOrderThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogTicketLine" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "orderThreadId" TEXT,
    "sourceMessageId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "sender" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedProduct" TEXT NOT NULL,
    "requestedQty" DECIMAL(14,4) NOT NULL,
    "requestedUnit" TEXT NOT NULL DEFAULT 'EA',
    "requestedQtyBase" DECIMAL(14,4),
    "baseUnit" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'MESSAGE_LINKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklogTicketLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogInvoiceDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sourceId" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "customerName" TEXT,
    "site" TEXT,
    "rawFileName" TEXT NOT NULL,
    "rawFileRef" TEXT,
    "rawText" TEXT,
    "fileBytes" INTEGER NOT NULL DEFAULT 0,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "parseStatus" TEXT NOT NULL DEFAULT 'UPLOADED',
    "parseError" TEXT,
    "totalAmount" DECIMAL(14,2),
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacklogInvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogInvoiceLine" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "documentId" TEXT,
    "sourceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "customer" TEXT,
    "site" TEXT,
    "canonicalSite" TEXT,
    "siteAliasUsed" BOOLEAN NOT NULL DEFAULT false,
    "orderRefRaw" TEXT,
    "orderRefTokens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderRefDateHint" TEXT,
    "orderRefItemHint" TEXT,
    "productDescription" TEXT NOT NULL,
    "normalizedProduct" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "qtyBase" DECIMAL(14,4),
    "baseUnit" TEXT,
    "rate" DECIMAL(14,2),
    "amount" DECIMAL(14,2),
    "lineHeaderText" TEXT,
    "isMaterialsHeader" BOOLEAN NOT NULL DEFAULT false,
    "isBillLinked" BOOLEAN NOT NULL DEFAULT false,
    "invoiceLineType" TEXT NOT NULL DEFAULT 'MANUAL_INVOICE_LINE',
    "billingConfidence" TEXT NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklogInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogInvoiceMatch" (
    "id" TEXT NOT NULL,
    "ticketLineId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "matchConfidence" DECIMAL(5,2),
    "matchMethod" TEXT,
    "matchUsedSiteAlias" BOOLEAN NOT NULL DEFAULT false,
    "matchUsedOrderRef" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklogInvoiceMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductNormalization" (
    "id" TEXT NOT NULL,
    "rawPattern" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "category" TEXT,
    "conversionFactor" DECIMAL(10,4),
    "conversionUnit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductNormalization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "canonicalUom" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstitutionFamily" (
    "id" TEXT NOT NULL,
    "familyCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "substitutionAllowed" BOOLEAN NOT NULL DEFAULT true,
    "directionality" TEXT NOT NULL DEFAULT 'BIDIRECTIONAL',
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstitutionFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstitutionFamilyMember" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstitutionFamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UomConversion" (
    "id" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "fromUom" TEXT NOT NULL,
    "toUom" TEXT NOT NULL,
    "factor" DECIMAL(14,6) NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "UomConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderGroup" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "fulfilmentStatus" "OrderFulfilmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
    "billingStatus" "OrderBillingStatus" NOT NULL DEFAULT 'UNBILLED',
    "closureStatus" "OrderClosureStatus" NOT NULL DEFAULT 'OPEN',
    "approvalStatus" "OrderGroupApproval" NOT NULL DEFAULT 'PENDING_REVIEW',
    "orderedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "suppliedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "billedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "siteConfidence" "SiteConfidence" NOT NULL DEFAULT 'UNKNOWN_SITE',
    "contaminationRisk" "ContaminationRisk" NOT NULL DEFAULT 'HIGH_RISK',
    "sourceChat" TEXT,
    "primarySender" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderGroupId" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT,
    "eventType" "OrderEventType" NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "rawUom" TEXT NOT NULL,
    "normalisedQty" DECIMAL(14,4),
    "canonicalUom" TEXT,
    "uomResolved" BOOLEAN NOT NULL DEFAULT false,
    "sourceMessageId" TEXT,
    "sourceText" TEXT,
    "sourceType" "OrderEventSource" NOT NULL DEFAULT 'TEXT_MESSAGE',
    "mediaEvidenceId" TEXT,
    "sourceConfidence" "SourceConfidence" NOT NULL DEFAULT 'LOW',
    "siteConfidence" "SiteConfidence" NOT NULL DEFAULT 'UNKNOWN_SITE',
    "contaminationRisk" "ContaminationRisk" NOT NULL DEFAULT 'HIGH_RISK',
    "timestamp" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyEvent" (
    "id" TEXT NOT NULL,
    "orderGroupId" TEXT,
    "canonicalProductId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "fulfilmentType" "FulfilmentType" NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "rawUom" TEXT NOT NULL,
    "normalisedQty" DECIMAL(14,4),
    "canonicalUom" TEXT,
    "uomResolved" BOOLEAN NOT NULL DEFAULT false,
    "sourceRef" TEXT,
    "evidenceRef" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialInvoice" (
    "id" TEXT NOT NULL,
    "zohoInvoiceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceStatus" "ZohoInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "customerId" TEXT,
    "siteId" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sourceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialInvoiceLine" (
    "id" TEXT NOT NULL,
    "commercialInvoiceId" TEXT NOT NULL,
    "canonicalProductId" TEXT,
    "description" TEXT NOT NULL,
    "rawProductText" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "rawUom" TEXT NOT NULL,
    "normalisedQty" DECIMAL(14,4),
    "canonicalUom" TEXT,
    "uomResolved" BOOLEAN NOT NULL DEFAULT false,
    "sellRate" DECIMAL(14,4),
    "sellAmount" DECIMAL(14,2),
    "allocationStatus" "InvoiceLineAllocStatus" NOT NULL DEFAULT 'UNALLOCATED',
    "allocationConfidence" DECIMAL(5,2),
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineAllocation" (
    "id" TEXT NOT NULL,
    "commercialInvoiceLineId" TEXT NOT NULL,
    "orderGroupId" TEXT NOT NULL,
    "allocatedQty" DECIMAL(14,4) NOT NULL,
    "confidence" DECIMAL(5,2),
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLineAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialBill" (
    "id" TEXT NOT NULL,
    "zohoBillId" TEXT,
    "billNumber" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "total" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialBillLine" (
    "id" TEXT NOT NULL,
    "commercialBillId" TEXT NOT NULL,
    "canonicalProductId" TEXT,
    "description" TEXT NOT NULL,
    "rawProductText" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "rawUom" TEXT NOT NULL,
    "normalisedQty" DECIMAL(14,4),
    "canonicalUom" TEXT,
    "uomResolved" BOOLEAN NOT NULL DEFAULT false,
    "costRate" DECIMAL(14,4),
    "costAmount" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillLineLink" (
    "id" TEXT NOT NULL,
    "commercialInvoiceLineId" TEXT NOT NULL,
    "commercialBillLineId" TEXT NOT NULL,
    "linkedQty" DECIMAL(14,4) NOT NULL,
    "costRate" DECIMAL(14,4),
    "costAmount" DECIMAL(14,2),
    "marginAmount" DECIMAL(14,2),
    "marginPct" DECIMAL(8,4),
    "costLinkStatus" "CostLinkStatus" NOT NULL DEFAULT 'NO_COST_LINKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillLineLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationResult" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "orderedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "suppliedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "billedQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "baseQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "recoverableQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "sellTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marginTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marginPct" DECIMAL(8,4),
    "orderGap" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "billingGap" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED_RECON',
    "familyStatus" TEXT,
    "uomValid" BOOLEAN NOT NULL DEFAULT false,
    "allocationComplete" BOOLEAN NOT NULL DEFAULT false,
    "orderCoverageComplete" BOOLEAN NOT NULL DEFAULT false,
    "substitutionEvidenced" BOOLEAN NOT NULL DEFAULT false,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewQueueItem" (
    "id" TEXT NOT NULL,
    "queueType" "ReviewQueueType" NOT NULL,
    "status" "ReviewQueueStatus" NOT NULL DEFAULT 'OPEN_REVIEW',
    "siteId" TEXT,
    "productCode" TEXT,
    "entityId" TEXT,
    "entityType" TEXT,
    "description" TEXT NOT NULL,
    "rawValue" TEXT,
    "resolvedValue" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingHistory" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "salePrice" DECIMAL(14,4) NOT NULL,
    "costPrice" DECIMAL(14,4),
    "qty" DECIMAL(14,4) NOT NULL,
    "marginAmount" DECIMAL(14,2),
    "marginPct" DECIMAL(8,4),
    "date" TIMESTAMP(3) NOT NULL,
    "siteId" TEXT,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" TEXT NOT NULL,
    "eventType" "InboundEventType" NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "externalRef" TEXT,
    "sender" TEXT,
    "senderPhone" TEXT,
    "senderEmail" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "rawText" TEXT,
    "subject" TEXT,
    "attachmentRef" TEXT,
    "siteId" TEXT,
    "customerId" TEXT,
    "linkStatus" "InboundLinkStatus" NOT NULL DEFAULT 'UNPROCESSED',
    "linkConfidence" DECIMAL(5,2),
    "linkReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "linkedTicketId" TEXT,
    "linkedEnquiryId" TEXT,
    "linkedOrderGroupId" TEXT,
    "linkedBacklogCaseId" TEXT,
    "provisionalLink" BOOLEAN NOT NULL DEFAULT false,
    "reviewTaskCreated" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "overrideEntityId" TEXT,
    "overrideReason" TEXT,
    "ingestionEventId" TEXT,
    "backlogMessageId" TEXT,
    "mediaEvidenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaEvidence" (
    "id" TEXT NOT NULL,
    "sourceChat" TEXT,
    "linkedMessageId" TEXT,
    "backlogMessageId" TEXT,
    "sender" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "fileName" TEXT,
    "filePath" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "rawText" TEXT,
    "extractedText" TEXT,
    "extractionMethod" TEXT,
    "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processingError" TEXT,
    "evidenceRole" "MediaEvidenceRole" NOT NULL DEFAULT 'UNKNOWN_MEDIA',
    "roleConfidence" "MediaConfidence" NOT NULL DEFAULT 'LOW',
    "classificationNotes" TEXT,
    "siteId" TEXT,
    "orderGroupId" TEXT,
    "candidateProducts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidateQtys" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogCompleteness" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "messagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalMedia" INTEGER NOT NULL DEFAULT 0,
    "mediaProcessed" INTEGER NOT NULL DEFAULT 0,
    "mediaExcluded" INTEGER NOT NULL DEFAULT 0,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacklogCompleteness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Site_siteName_idx" ON "Site"("siteName");

-- CreateIndex
CREATE INDEX "Site_siteCode_idx" ON "Site"("siteCode");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Contact_fullName_idx" ON "Contact"("fullName");

-- CreateIndex
CREATE INDEX "SiteCommercialLink_siteId_idx" ON "SiteCommercialLink"("siteId");

-- CreateIndex
CREATE INDEX "SiteCommercialLink_customerId_idx" ON "SiteCommercialLink"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteCommercialLink_siteId_customerId_role_key" ON "SiteCommercialLink"("siteId", "customerId", "role");

-- CreateIndex
CREATE INDEX "SiteContactLink_siteId_contactId_idx" ON "SiteContactLink"("siteId", "contactId");

-- CreateIndex
CREATE INDEX "IngestionEvent_status_idx" ON "IngestionEvent"("status");

-- CreateIndex
CREATE INDEX "IngestionEvent_eventKind_idx" ON "IngestionEvent"("eventKind");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionEvent_sourceId_externalMessageId_key" ON "IngestionEvent"("sourceId", "externalMessageId");

-- CreateIndex
CREATE INDEX "IngestionLink_linkStatus_idx" ON "IngestionLink"("linkStatus");

-- CreateIndex
CREATE INDEX "Enquiry_status_idx" ON "Enquiry"("status");

-- CreateIndex
CREATE INDEX "Enquiry_sourceType_idx" ON "Enquiry"("sourceType");

-- CreateIndex
CREATE INDEX "EnquiryTask_enquiryId_idx" ON "EnquiryTask"("enquiryId");

-- CreateIndex
CREATE INDEX "EnquiryTask_status_idx" ON "EnquiryTask"("status");

-- CreateIndex
CREATE INDEX "InquiryWorkItem_status_idx" ON "InquiryWorkItem"("status");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_payingCustomerId_idx" ON "Ticket"("payingCustomerId");

-- CreateIndex
CREATE INDEX "Ticket_siteId_idx" ON "Ticket"("siteId");

-- CreateIndex
CREATE INDEX "Ticket_ticketMode_idx" ON "Ticket"("ticketMode");

-- CreateIndex
CREATE INDEX "TicketLine_ticketId_idx" ON "TicketLine"("ticketId");

-- CreateIndex
CREATE INDEX "TicketLine_status_idx" ON "TicketLine"("status");

-- CreateIndex
CREATE INDEX "TicketLine_payingCustomerId_idx" ON "TicketLine"("payingCustomerId");

-- CreateIndex
CREATE INDEX "Quote_quoteNo_idx" ON "Quote"("quoteNo");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "ProcurementOrder_poNo_idx" ON "ProcurementOrder"("poNo");

-- CreateIndex
CREATE INDEX "SupplierBill_billNo_idx" ON "SupplierBill"("billNo");

-- CreateIndex
CREATE INDEX "SupplierBillLine_allocationStatus_idx" ON "SupplierBillLine"("allocationStatus");

-- CreateIndex
CREATE INDEX "CustomerPO_poNo_idx" ON "CustomerPO"("poNo");

-- CreateIndex
CREATE INDEX "SalesInvoice_invoiceNo_idx" ON "SalesInvoice"("invoiceNo");

-- CreateIndex
CREATE INDEX "SalesInvoice_status_idx" ON "SalesInvoice"("status");

-- CreateIndex
CREATE INDEX "CreditNote_creditNoteNo_idx" ON "CreditNote"("creditNoteNo");

-- CreateIndex
CREATE INDEX "SiteAlias_aliasText_idx" ON "SiteAlias"("aliasText");

-- CreateIndex
CREATE UNIQUE INDEX "SiteAlias_siteId_aliasText_key" ON "SiteAlias"("siteId", "aliasText");

-- CreateIndex
CREATE INDEX "CustomerAlias_aliasText_idx" ON "CustomerAlias"("aliasText");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAlias_customerId_aliasText_key" ON "CustomerAlias"("customerId", "aliasText");

-- CreateIndex
CREATE INDEX "ManualLinkAudit_linkType_idx" ON "ManualLinkAudit"("linkType");

-- CreateIndex
CREATE INDEX "ManualLinkAudit_sourceId_idx" ON "ManualLinkAudit"("sourceId");

-- CreateIndex
CREATE INDEX "ManualLinkAudit_targetId_idx" ON "ManualLinkAudit"("targetId");

-- CreateIndex
CREATE INDEX "SourceSiteMatch_reviewStatus_idx" ON "SourceSiteMatch"("reviewStatus");

-- CreateIndex
CREATE INDEX "SourceSiteMatch_rawSiteText_idx" ON "SourceSiteMatch"("rawSiteText");

-- CreateIndex
CREATE INDEX "DraftInvoiceRecoveryItem_status_idx" ON "DraftInvoiceRecoveryItem"("status");

-- CreateIndex
CREATE INDEX "DraftInvoiceRecoveryItem_verificationStatus_idx" ON "DraftInvoiceRecoveryItem"("verificationStatus");

-- CreateIndex
CREATE INDEX "DraftInvoiceRecoveryItem_zohoInvoiceExternalId_idx" ON "DraftInvoiceRecoveryItem"("zohoInvoiceExternalId");

-- CreateIndex
CREATE INDEX "DraftInvoiceRecoveryItem_ingestionEventId_idx" ON "DraftInvoiceRecoveryItem"("ingestionEventId");

-- CreateIndex
CREATE INDEX "IngestionAuditLog_objectType_objectId_idx" ON "IngestionAuditLog"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "IngestionAuditLog_actionType_idx" ON "IngestionAuditLog"("actionType");

-- CreateIndex
CREATE INDEX "IngestionAuditLog_createdAt_idx" ON "IngestionAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "ReconstructionBatch_status_idx" ON "ReconstructionBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReconstructionBatch_monthYear_key" ON "ReconstructionBatch"("monthYear");

-- CreateIndex
CREATE INDEX "ExtractionBatch_ticketId_idx" ON "ExtractionBatch"("ticketId");

-- CreateIndex
CREATE INDEX "ExtractionBatch_enquiryId_idx" ON "ExtractionBatch"("enquiryId");

-- CreateIndex
CREATE INDEX "ExtractionBatch_status_idx" ON "ExtractionBatch"("status");

-- CreateIndex
CREATE INDEX "ExtractedLineCandidate_batchId_idx" ON "ExtractedLineCandidate"("batchId");

-- CreateIndex
CREATE INDEX "ExtractedLineCandidate_status_idx" ON "ExtractedLineCandidate"("status");

-- CreateIndex
CREATE INDEX "ExtractedLineCandidate_groupLabel_idx" ON "ExtractedLineCandidate"("groupLabel");

-- CreateIndex
CREATE INDEX "BacklogCase_name_idx" ON "BacklogCase"("name");

-- CreateIndex
CREATE INDEX "BacklogSourceGroup_caseId_idx" ON "BacklogSourceGroup"("caseId");

-- CreateIndex
CREATE INDEX "BacklogSource_groupId_idx" ON "BacklogSource"("groupId");

-- CreateIndex
CREATE INDEX "BacklogSource_parseStatus_idx" ON "BacklogSource"("parseStatus");

-- CreateIndex
CREATE INDEX "BacklogMessage_sourceId_idx" ON "BacklogMessage"("sourceId");

-- CreateIndex
CREATE INDEX "BacklogMessage_parsedTimestamp_idx" ON "BacklogMessage"("parsedTimestamp");

-- CreateIndex
CREATE INDEX "BacklogMessage_messageType_idx" ON "BacklogMessage"("messageType");

-- CreateIndex
CREATE INDEX "BacklogMessage_sender_idx" ON "BacklogMessage"("sender");

-- CreateIndex
CREATE INDEX "BacklogMessage_relationType_idx" ON "BacklogMessage"("relationType");

-- CreateIndex
CREATE INDEX "BacklogMessage_duplicateGroupId_idx" ON "BacklogMessage"("duplicateGroupId");

-- CreateIndex
CREATE INDEX "BacklogMessage_timestampConfidence_idx" ON "BacklogMessage"("timestampConfidence");

-- CreateIndex
CREATE INDEX "BacklogOrderThread_caseId_idx" ON "BacklogOrderThread"("caseId");

-- CreateIndex
CREATE INDEX "BacklogTicketLine_caseId_idx" ON "BacklogTicketLine"("caseId");

-- CreateIndex
CREATE INDEX "BacklogTicketLine_normalizedProduct_idx" ON "BacklogTicketLine"("normalizedProduct");

-- CreateIndex
CREATE INDEX "BacklogTicketLine_sourceMessageId_idx" ON "BacklogTicketLine"("sourceMessageId");

-- CreateIndex
CREATE INDEX "BacklogTicketLine_orderThreadId_idx" ON "BacklogTicketLine"("orderThreadId");

-- CreateIndex
CREATE INDEX "BacklogInvoiceDocument_caseId_idx" ON "BacklogInvoiceDocument"("caseId");

-- CreateIndex
CREATE INDEX "BacklogInvoiceDocument_sourceId_idx" ON "BacklogInvoiceDocument"("sourceId");

-- CreateIndex
CREATE INDEX "BacklogInvoiceDocument_parseStatus_idx" ON "BacklogInvoiceDocument"("parseStatus");

-- CreateIndex
CREATE INDEX "BacklogInvoiceLine_caseId_idx" ON "BacklogInvoiceLine"("caseId");

-- CreateIndex
CREATE INDEX "BacklogInvoiceLine_documentId_idx" ON "BacklogInvoiceLine"("documentId");

-- CreateIndex
CREATE INDEX "BacklogInvoiceLine_sourceId_idx" ON "BacklogInvoiceLine"("sourceId");

-- CreateIndex
CREATE INDEX "BacklogInvoiceLine_normalizedProduct_idx" ON "BacklogInvoiceLine"("normalizedProduct");

-- CreateIndex
CREATE INDEX "BacklogInvoiceLine_invoiceNumber_idx" ON "BacklogInvoiceLine"("invoiceNumber");

-- CreateIndex
CREATE INDEX "BacklogInvoiceMatch_ticketLineId_idx" ON "BacklogInvoiceMatch"("ticketLineId");

-- CreateIndex
CREATE INDEX "BacklogInvoiceMatch_invoiceLineId_idx" ON "BacklogInvoiceMatch"("invoiceLineId");

-- CreateIndex
CREATE INDEX "ProductNormalization_normalizedName_idx" ON "ProductNormalization"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "ProductNormalization_rawPattern_key" ON "ProductNormalization"("rawPattern");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalProduct_code_key" ON "CanonicalProduct"("code");

-- CreateIndex
CREATE INDEX "CanonicalProduct_code_idx" ON "CanonicalProduct"("code");

-- CreateIndex
CREATE INDEX "CanonicalProduct_category_idx" ON "CanonicalProduct"("category");

-- CreateIndex
CREATE UNIQUE INDEX "SubstitutionFamily_familyCode_key" ON "SubstitutionFamily"("familyCode");

-- CreateIndex
CREATE UNIQUE INDEX "SubstitutionFamilyMember_familyId_canonicalProductId_key" ON "SubstitutionFamilyMember"("familyId", "canonicalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "UomConversion_canonicalProductId_fromUom_toUom_key" ON "UomConversion"("canonicalProductId", "fromUom", "toUom");

-- CreateIndex
CREATE INDEX "OrderGroup_siteId_idx" ON "OrderGroup"("siteId");

-- CreateIndex
CREATE INDEX "OrderGroup_closureStatus_idx" ON "OrderGroup"("closureStatus");

-- CreateIndex
CREATE INDEX "OrderGroup_approvalStatus_idx" ON "OrderGroup"("approvalStatus");

-- CreateIndex
CREATE INDEX "OrderGroup_siteConfidence_idx" ON "OrderGroup"("siteConfidence");

-- CreateIndex
CREATE INDEX "OrderEvent_orderGroupId_idx" ON "OrderEvent"("orderGroupId");

-- CreateIndex
CREATE INDEX "OrderEvent_canonicalProductId_idx" ON "OrderEvent"("canonicalProductId");

-- CreateIndex
CREATE INDEX "OrderEvent_siteId_idx" ON "OrderEvent"("siteId");

-- CreateIndex
CREATE INDEX "OrderEvent_eventType_idx" ON "OrderEvent"("eventType");

-- CreateIndex
CREATE INDEX "OrderEvent_timestamp_idx" ON "OrderEvent"("timestamp");

-- CreateIndex
CREATE INDEX "OrderEvent_sourceType_idx" ON "OrderEvent"("sourceType");

-- CreateIndex
CREATE INDEX "SupplyEvent_orderGroupId_idx" ON "SupplyEvent"("orderGroupId");

-- CreateIndex
CREATE INDEX "SupplyEvent_canonicalProductId_idx" ON "SupplyEvent"("canonicalProductId");

-- CreateIndex
CREATE INDEX "SupplyEvent_siteId_idx" ON "SupplyEvent"("siteId");

-- CreateIndex
CREATE INDEX "SupplyEvent_fulfilmentType_idx" ON "SupplyEvent"("fulfilmentType");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialInvoice_zohoInvoiceId_key" ON "CommercialInvoice"("zohoInvoiceId");

-- CreateIndex
CREATE INDEX "CommercialInvoice_invoiceNumber_idx" ON "CommercialInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "CommercialInvoice_invoiceStatus_idx" ON "CommercialInvoice"("invoiceStatus");

-- CreateIndex
CREATE INDEX "CommercialInvoice_siteId_idx" ON "CommercialInvoice"("siteId");

-- CreateIndex
CREATE INDEX "CommercialInvoiceLine_commercialInvoiceId_idx" ON "CommercialInvoiceLine"("commercialInvoiceId");

-- CreateIndex
CREATE INDEX "CommercialInvoiceLine_canonicalProductId_idx" ON "CommercialInvoiceLine"("canonicalProductId");

-- CreateIndex
CREATE INDEX "CommercialInvoiceLine_allocationStatus_idx" ON "CommercialInvoiceLine"("allocationStatus");

-- CreateIndex
CREATE INDEX "InvoiceLineAllocation_commercialInvoiceLineId_idx" ON "InvoiceLineAllocation"("commercialInvoiceLineId");

-- CreateIndex
CREATE INDEX "InvoiceLineAllocation_orderGroupId_idx" ON "InvoiceLineAllocation"("orderGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialBill_zohoBillId_key" ON "CommercialBill"("zohoBillId");

-- CreateIndex
CREATE INDEX "CommercialBill_billNumber_idx" ON "CommercialBill"("billNumber");

-- CreateIndex
CREATE INDEX "CommercialBill_supplierId_idx" ON "CommercialBill"("supplierId");

-- CreateIndex
CREATE INDEX "CommercialBillLine_commercialBillId_idx" ON "CommercialBillLine"("commercialBillId");

-- CreateIndex
CREATE INDEX "CommercialBillLine_canonicalProductId_idx" ON "CommercialBillLine"("canonicalProductId");

-- CreateIndex
CREATE INDEX "BillLineLink_commercialInvoiceLineId_idx" ON "BillLineLink"("commercialInvoiceLineId");

-- CreateIndex
CREATE INDEX "BillLineLink_commercialBillLineId_idx" ON "BillLineLink"("commercialBillLineId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_siteId_idx" ON "ReconciliationResult"("siteId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_status_idx" ON "ReconciliationResult"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationResult_siteId_canonicalProductId_key" ON "ReconciliationResult"("siteId", "canonicalProductId");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_queueType_idx" ON "ReviewQueueItem"("queueType");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_status_idx" ON "ReviewQueueItem"("status");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_siteId_idx" ON "ReviewQueueItem"("siteId");

-- CreateIndex
CREATE INDEX "PricingHistory_customerId_canonicalProductId_idx" ON "PricingHistory"("customerId", "canonicalProductId");

-- CreateIndex
CREATE INDEX "PricingHistory_customerId_canonicalProductId_date_idx" ON "PricingHistory"("customerId", "canonicalProductId", "date");

-- CreateIndex
CREATE INDEX "PricingHistory_date_idx" ON "PricingHistory"("date");

-- CreateIndex
CREATE INDEX "InboundEvent_linkStatus_idx" ON "InboundEvent"("linkStatus");

-- CreateIndex
CREATE INDEX "InboundEvent_sender_idx" ON "InboundEvent"("sender");

-- CreateIndex
CREATE INDEX "InboundEvent_senderPhone_idx" ON "InboundEvent"("senderPhone");

-- CreateIndex
CREATE INDEX "InboundEvent_senderEmail_idx" ON "InboundEvent"("senderEmail");

-- CreateIndex
CREATE INDEX "InboundEvent_siteId_idx" ON "InboundEvent"("siteId");

-- CreateIndex
CREATE INDEX "InboundEvent_customerId_idx" ON "InboundEvent"("customerId");

-- CreateIndex
CREATE INDEX "InboundEvent_linkedTicketId_idx" ON "InboundEvent"("linkedTicketId");

-- CreateIndex
CREATE INDEX "InboundEvent_linkedEnquiryId_idx" ON "InboundEvent"("linkedEnquiryId");

-- CreateIndex
CREATE INDEX "InboundEvent_linkedOrderGroupId_idx" ON "InboundEvent"("linkedOrderGroupId");

-- CreateIndex
CREATE INDEX "InboundEvent_receivedAt_idx" ON "InboundEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "MediaEvidence_processingStatus_idx" ON "MediaEvidence"("processingStatus");

-- CreateIndex
CREATE INDEX "MediaEvidence_evidenceRole_idx" ON "MediaEvidence"("evidenceRole");

-- CreateIndex
CREATE INDEX "MediaEvidence_siteId_idx" ON "MediaEvidence"("siteId");

-- CreateIndex
CREATE INDEX "MediaEvidence_linkedMessageId_idx" ON "MediaEvidence"("linkedMessageId");

-- CreateIndex
CREATE INDEX "MediaEvidence_backlogMessageId_idx" ON "MediaEvidence"("backlogMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "BacklogCompleteness_caseId_key" ON "BacklogCompleteness"("caseId");

-- CreateIndex
CREATE INDEX "BacklogCompleteness_caseId_idx" ON "BacklogCompleteness"("caseId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentJob" ADD CONSTRAINT "ParentJob_primarySiteId_fkey" FOREIGN KEY ("primarySiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_parentCustomerEntityId_fkey" FOREIGN KEY ("parentCustomerEntityId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteCommercialLink" ADD CONSTRAINT "SiteCommercialLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteCommercialLink" ADD CONSTRAINT "SiteCommercialLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContactLink" ADD CONSTRAINT "SiteContactLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContactLink" ADD CONSTRAINT "SiteContactLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContactLink" ADD CONSTRAINT "SiteContactLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteContactLink" ADD CONSTRAINT "SiteContactLink_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionEvent" ADD CONSTRAINT "IngestionEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IngestionSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedMessage" ADD CONSTRAINT "ParsedMessage_ingestionEventId_fkey" FOREIGN KEY ("ingestionEventId") REFERENCES "IngestionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedEntity" ADD CONSTRAINT "ExtractedEntity_parsedMessageId_fkey" FOREIGN KEY ("parsedMessageId") REFERENCES "ParsedMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_parsedMessageId_fkey" FOREIGN KEY ("parsedMessageId") REFERENCES "ParsedMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_evidenceFragmentId_fkey" FOREIGN KEY ("evidenceFragmentId") REFERENCES "EvidenceFragment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_inquiryWorkItemId_fkey" FOREIGN KEY ("inquiryWorkItemId") REFERENCES "InquiryWorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_supplierBillLineId_fkey" FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLink" ADD CONSTRAINT "IngestionLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "ParentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_sourceContactId_fkey" FOREIGN KEY ("sourceContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_suggestedSiteId_fkey" FOREIGN KEY ("suggestedSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_suggestedCustomerId_fkey" FOREIGN KEY ("suggestedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_suggestedSiteCommercialLinkId_fkey" FOREIGN KEY ("suggestedSiteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryTask" ADD CONSTRAINT "EnquiryTask_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryWorkItem" ADD CONSTRAINT "InquiryWorkItem_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryWorkItem" ADD CONSTRAINT "InquiryWorkItem_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "ParentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryWorkItem" ADD CONSTRAINT "InquiryWorkItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryWorkItem" ADD CONSTRAINT "InquiryWorkItem_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryWorkItem" ADD CONSTRAINT "InquiryWorkItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryWorkItem" ADD CONSTRAINT "InquiryWorkItem_requestedByContactId_fkey" FOREIGN KEY ("requestedByContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "ParentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_payingCustomerId_fkey" FOREIGN KEY ("payingCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requestedByContactId_fkey" FOREIGN KEY ("requestedByContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_actingOnBehalfOfContactId_fkey" FOREIGN KEY ("actingOnBehalfOfContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketPhase" ADD CONSTRAINT "TicketPhase_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_ticketPhaseId_fkey" FOREIGN KEY ("ticketPhaseId") REFERENCES "TicketPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_payingCustomerId_fkey" FOREIGN KEY ("payingCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_requestedByContactId_fkey" FOREIGN KEY ("requestedByContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBundle" ADD CONSTRAINT "SalesBundle_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBundleCostLink" ADD CONSTRAINT "SalesBundleCostLink_salesBundleId_fkey" FOREIGN KEY ("salesBundleId") REFERENCES "SalesBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesBundleCostLink" ADD CONSTRAINT "SalesBundleCostLink_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealSheet" ADD CONSTRAINT "DealSheet_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealSheetLineSnapshot" ADD CONSTRAINT "DealSheetLineSnapshot_dealSheetId_fkey" FOREIGN KEY ("dealSheetId") REFERENCES "DealSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealSheetLineSnapshot" ADD CONSTRAINT "DealSheetLineSnapshot_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Benchmark" ADD CONSTRAINT "Benchmark_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompSheet" ADD CONSTRAINT "CompSheet_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompSheetLine" ADD CONSTRAINT "CompSheetLine_compSheetId_fkey" FOREIGN KEY ("compSheetId") REFERENCES "CompSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompSheetLine" ADD CONSTRAINT "CompSheetLine_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_ticketPhaseId_fkey" FOREIGN KEY ("ticketPhaseId") REFERENCES "TicketPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOption" ADD CONSTRAINT "SupplierOption_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOption" ADD CONSTRAINT "SupplierOption_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementOrder" ADD CONSTRAINT "ProcurementOrder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementOrder" ADD CONSTRAINT "ProcurementOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementOrderLine" ADD CONSTRAINT "ProcurementOrderLine_procurementOrderId_fkey" FOREIGN KEY ("procurementOrderId") REFERENCES "ProcurementOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementOrderLine" ADD CONSTRAINT "ProcurementOrderLine_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementOrderLine" ADD CONSTRAINT "ProcurementOrderLine_supplierOptionId_fkey" FOREIGN KEY ("supplierOptionId") REFERENCES "SupplierOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_supplierBillLineId_fkey" FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_procurementOrderLineId_fkey" FOREIGN KEY ("procurementOrderLineId") REFERENCES "ProcurementOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPO" ADD CONSTRAINT "CustomerPO_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPO" ADD CONSTRAINT "CustomerPO_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPO" ADD CONSTRAINT "CustomerPO_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPO" ADD CONSTRAINT "CustomerPO_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPOLine" ADD CONSTRAINT "CustomerPOLine_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPOLine" ADD CONSTRAINT "CustomerPOLine_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPOAllocation" ADD CONSTRAINT "CustomerPOAllocation_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPOAllocation" ADD CONSTRAINT "CustomerPOAllocation_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPOAllocation" ADD CONSTRAINT "CustomerPOAllocation_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourDrawdownEntry" ADD CONSTRAINT "LabourDrawdownEntry_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourDrawdownEntry" ADD CONSTRAINT "LabourDrawdownEntry_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourDrawdownEntry" ADD CONSTRAINT "LabourDrawdownEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourDrawdownEntry" ADD CONSTRAINT "LabourDrawdownEntry_plumberContactId_fkey" FOREIGN KEY ("plumberContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialsDrawdownEntry" ADD CONSTRAINT "MaterialsDrawdownEntry_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialsDrawdownEntry" ADD CONSTRAINT "MaterialsDrawdownEntry_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialsDrawdownEntry" ADD CONSTRAINT "MaterialsDrawdownEntry_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_siteCommercialLinkId_fkey" FOREIGN KEY ("siteCommercialLinkId") REFERENCES "SiteCommercialLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFragment" ADD CONSTRAINT "EvidenceFragment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFragment" ADD CONSTRAINT "EvidenceFragment_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFragment" ADD CONSTRAINT "EvidenceFragment_sourceContactId_fkey" FOREIGN KEY ("sourceContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCase" ADD CONSTRAINT "RecoveryCase_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePack" ADD CONSTRAINT "EvidencePack_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePack" ADD CONSTRAINT "EvidencePack_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePackItem" ADD CONSTRAINT "EvidencePackItem_evidencePackId_fkey" FOREIGN KEY ("evidencePackId") REFERENCES "EvidencePack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePackItem" ADD CONSTRAINT "EvidencePackItem_evidenceFragmentId_fkey" FOREIGN KEY ("evidenceFragmentId") REFERENCES "EvidenceFragment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePackItem" ADD CONSTRAINT "EvidencePackItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsEvent" ADD CONSTRAINT "LogisticsEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsEvent" ADD CONSTRAINT "LogisticsEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsEvent" ADD CONSTRAINT "LogisticsEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "Return"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_supplierBillLineId_fkey" FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteAllocation" ADD CONSTRAINT "CreditNoteAllocation_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteAllocation" ADD CONSTRAINT "CreditNoteAllocation_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "ReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteAllocation" ADD CONSTRAINT "CreditNoteAllocation_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsorbedCostAllocation" ADD CONSTRAINT "AbsorbedCostAllocation_supplierBillLineId_fkey" FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsorbedCostAllocation" ADD CONSTRAINT "AbsorbedCostAllocation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsorbedCostAllocation" ADD CONSTRAINT "AbsorbedCostAllocation_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockExcessRecord" ADD CONSTRAINT "StockExcessRecord_supplierBillLineId_fkey" FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockExcessRecord" ADD CONSTRAINT "StockExcessRecord_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReallocationRecord" ADD CONSTRAINT "ReallocationRecord_fromTicketLineId_fkey" FOREIGN KEY ("fromTicketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReallocationRecord" ADD CONSTRAINT "ReallocationRecord_toTicketLineId_fkey" FOREIGN KEY ("toTicketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabourEntry" ADD CONSTRAINT "LabourEntry_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSale" ADD CONSTRAINT "CashSale_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePack" ADD CONSTRAINT "SitePack_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePackItem" ADD CONSTRAINT "SitePackItem_sitePackId_fkey" FOREIGN KEY ("sitePackId") REFERENCES "SitePack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePackItem" ADD CONSTRAINT "SitePackItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePackItem" ADD CONSTRAINT "SitePackItem_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePackItem" ADD CONSTRAINT "SitePackItem_evidencePackId_fkey" FOREIGN KEY ("evidencePackId") REFERENCES "EvidencePack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAlias" ADD CONSTRAINT "SiteAlias_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSiteMatch" ADD CONSTRAINT "SourceSiteMatch_matchedSiteId_fkey" FOREIGN KEY ("matchedSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSiteMatch" ADD CONSTRAINT "SourceSiteMatch_ingestionEventId_fkey" FOREIGN KEY ("ingestionEventId") REFERENCES "IngestionEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftInvoiceRecoveryItem" ADD CONSTRAINT "DraftInvoiceRecoveryItem_ingestionEventId_fkey" FOREIGN KEY ("ingestionEventId") REFERENCES "IngestionEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedLineCandidate" ADD CONSTRAINT "ExtractedLineCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ExtractionBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogCase" ADD CONSTRAINT "BacklogCase_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogSourceGroup" ADD CONSTRAINT "BacklogSourceGroup_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "BacklogCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogSource" ADD CONSTRAINT "BacklogSource_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BacklogSourceGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogMessage" ADD CONSTRAINT "BacklogMessage_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BacklogSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogTicketLine" ADD CONSTRAINT "BacklogTicketLine_orderThreadId_fkey" FOREIGN KEY ("orderThreadId") REFERENCES "BacklogOrderThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogInvoiceLine" ADD CONSTRAINT "BacklogInvoiceLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BacklogInvoiceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogInvoiceMatch" ADD CONSTRAINT "BacklogInvoiceMatch_ticketLineId_fkey" FOREIGN KEY ("ticketLineId") REFERENCES "BacklogTicketLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogInvoiceMatch" ADD CONSTRAINT "BacklogInvoiceMatch_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "BacklogInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionFamilyMember" ADD CONSTRAINT "SubstitutionFamilyMember_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "SubstitutionFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionFamilyMember" ADD CONSTRAINT "SubstitutionFamilyMember_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UomConversion" ADD CONSTRAINT "UomConversion_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderGroup" ADD CONSTRAINT "OrderGroup_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "OrderGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_mediaEvidenceId_fkey" FOREIGN KEY ("mediaEvidenceId") REFERENCES "MediaEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvent" ADD CONSTRAINT "SupplyEvent_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "OrderGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyEvent" ADD CONSTRAINT "SupplyEvent_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialInvoiceLine" ADD CONSTRAINT "CommercialInvoiceLine_commercialInvoiceId_fkey" FOREIGN KEY ("commercialInvoiceId") REFERENCES "CommercialInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialInvoiceLine" ADD CONSTRAINT "CommercialInvoiceLine_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_commercialInvoiceLineId_fkey" FOREIGN KEY ("commercialInvoiceLineId") REFERENCES "CommercialInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineAllocation" ADD CONSTRAINT "InvoiceLineAllocation_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "OrderGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialBillLine" ADD CONSTRAINT "CommercialBillLine_commercialBillId_fkey" FOREIGN KEY ("commercialBillId") REFERENCES "CommercialBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialBillLine" ADD CONSTRAINT "CommercialBillLine_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineLink" ADD CONSTRAINT "BillLineLink_commercialInvoiceLineId_fkey" FOREIGN KEY ("commercialInvoiceLineId") REFERENCES "CommercialInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineLink" ADD CONSTRAINT "BillLineLink_commercialBillLineId_fkey" FOREIGN KEY ("commercialBillLineId") REFERENCES "CommercialBillLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingHistory" ADD CONSTRAINT "PricingHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingHistory" ADD CONSTRAINT "PricingHistory_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

