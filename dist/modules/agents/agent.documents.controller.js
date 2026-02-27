"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentDocuments = getAgentDocuments;
exports.getAgentDocument = getAgentDocument;
exports.uploadAgentDocument = uploadAgentDocument;
exports.updateDocumentStatus = updateDocumentStatus;
exports.deleteDocument = deleteDocument;
const db_1 = __importDefault(require("../../config/db"));
/**
 * Get all customer documents managed by the agent
 * GET /api/agent/documents
 */
async function getAgentDocuments(req, res) {
    try {
        const agentId = req.user.id;
        const { search, status, type } = req.query;
        const where = { agentId };
        if (status && status !== 'All') {
            where.status = status;
        }
        if (type && type !== 'All') {
            where.documentType = type;
        }
        if (search) {
            where.OR = [
                { fileName: { contains: search, mode: 'insensitive' } },
                { customer: { fullName: { contains: search, mode: 'insensitive' } } }
            ];
        }
        const documents = await db_1.default.customerDocument.findMany({
            where,
            include: {
                customer: { select: { fullName: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        const formatted = documents.map(doc => ({
            id: doc.id,
            documentType: doc.documentType,
            customerName: doc.customer.fullName,
            customerId: `#CUS-${doc.customerId.slice(0, 5).toUpperCase()}`,
            uploadDate: doc.createdAt.toISOString(),
            status: doc.status,
            fileUrl: doc.fileUrl,
            fileName: doc.fileName,
            fileSize: doc.fileSize,
            notes: doc.notes
        }));
        res.json(formatted);
    }
    catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).json({ error: "Failed to fetch documents" });
    }
}
/**
 * Get single document details
 * GET /api/agent/documents/:id
 */
async function getAgentDocument(req, res) {
    try {
        const { id } = req.params;
        const agentId = req.user.id;
        const doc = await db_1.default.customerDocument.findFirst({
            where: { id, agentId },
            include: { customer: true }
        });
        if (!doc) {
            return res.status(404).json({ error: "Document not found" });
        }
        res.json({
            id: doc.id,
            documentType: doc.documentType,
            customerName: doc.customer.fullName,
            customerId: `#CUS-${doc.customerId.slice(0, 5).toUpperCase()}`,
            uploadDate: doc.createdAt.toISOString(),
            status: doc.status,
            fileUrl: doc.fileUrl,
            fileName: doc.fileName,
            fileSize: doc.fileSize,
            notes: doc.notes
        });
    }
    catch (error) {
        console.error("Error fetching document:", error);
        res.status(500).json({ error: "Failed to fetch document" });
    }
}
/**
 * Upload new document for a customer
 * POST /api/agent/documents
 */
async function uploadAgentDocument(req, res) {
    // We will implement multer logic here next
    res.status(501).json({ error: "Not implemented yet" });
}
/**
 * Update document status or notes
 * PATCH /api/agent/documents/:id
 */
async function updateDocumentStatus(req, res) {
    try {
        const { id } = req.params;
        const agentId = req.user.id;
        const { status, notes } = req.body;
        const doc = await db_1.default.customerDocument.update({
            where: { id },
            data: { status, notes }
        });
        // Normally agents might not approve their own customers' docs if it requires Compliance role,
        // but depending on the flow they might edit internal status.
        res.json(doc);
    }
    catch (error) {
        console.error("Error updating document:", error);
        res.status(500).json({ error: "Failed to update document" });
    }
}
/**
 * Delete a document
 * DELETE /api/agent/documents/:id
 */
async function deleteDocument(req, res) {
    try {
        const { id } = req.params;
        const agentId = req.user.id;
        await db_1.default.customerDocument.delete({
            where: { id, agentId }
        });
        res.json({ deleted: true });
    }
    catch (error) {
        console.error("Error deleting document:", error);
        res.status(500).json({ error: "Failed to delete document" });
    }
}
