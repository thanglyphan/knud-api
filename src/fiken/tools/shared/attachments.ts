/**
 * Fiken Shared Attachment Module
 * 
 * Delt modul for opplasting av vedlegg (bilder, PDF, etc.) til ulike entiteter i Fiken.
 * Brukes av alle agenter.
 */

import { z } from "zod";
import { tool } from "ai";
import type { FikenClient } from "../../client.js";

// Type for file attachment passed from chat
export interface PendingFile {
  name: string;
  type: string;
  data: string; // base64 data URL
}

// Helper to convert base64 data URL to FormData for Fiken API
export function createAttachmentFormData(
  file: PendingFile, 
  options?: { 
    attachToPayment?: boolean; 
    attachToSale?: boolean 
  }
): FormData {
  // Extract base64 data from data URL (remove "data:image/png;base64," prefix)
  const base64Data = file.data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const blob = new Blob([buffer], { type: file.type });
  
  const formData = new FormData();
  formData.append("file", blob, file.name);
  formData.append("filename", file.name);
  
  // For purchases, at least one of these must be true
  if (options?.attachToPayment !== undefined) {
    formData.append("attachToPayment", String(options.attachToPayment));
  }
  if (options?.attachToSale !== undefined) {
    formData.append("attachToSale", String(options.attachToSale));
  }
  
  return formData;
}

// Upload result type
export interface UploadResult {
  name: string;
  identifier?: string;
  downloadUrl?: string;
}

// Generic upload function for a single file
async function uploadSingleFile(
  file: PendingFile,
  uploadFn: (formData: FormData) => Promise<{ identifier?: string; downloadUrl?: string }>,
  formDataOptions?: { attachToPayment?: boolean; attachToSale?: boolean }
): Promise<UploadResult> {
  const formData = createAttachmentFormData(file, formDataOptions);
  const result = await uploadFn(formData);
  return {
    name: file.name,
    identifier: result.identifier,
    downloadUrl: result.downloadUrl,
  };
}

// Generic upload function for multiple files
async function uploadMultipleFiles(
  files: PendingFile[],
  uploadFn: (formData: FormData) => Promise<{ identifier?: string; downloadUrl?: string }>,
  formDataOptions?: { attachToPayment?: boolean; attachToSale?: boolean }
): Promise<{ uploaded: UploadResult[]; errors: string[] }> {
  const uploaded: UploadResult[] = [];
  const errors: string[] = [];
  
  for (const file of files) {
    try {
      const result = await uploadSingleFile(file, uploadFn, formDataOptions);
      uploaded.push(result);
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : "Ukjent feil"}`);
    }
  }
  
  return { uploaded, errors };
}

/**
 * Attachment target types
 */
export type AttachmentTarget = 
  | { type: 'purchase'; purchaseId: number }
  | { type: 'sale'; saleId: number }
  | { type: 'invoice'; invoiceId: number }
  | { type: 'journalEntry'; journalEntryId: number }
  | { type: 'contact'; contactId: number }
  | { type: 'invoiceDraft'; draftId: number }
  | { type: 'creditNoteDraft'; draftId: number }
  | { type: 'purchaseDraft'; draftId: number }
  | { type: 'saleDraft'; draftId: number }
  | { type: 'offerDraft'; draftId: number }
  | { type: 'orderConfirmationDraft'; draftId: number };

/**
 * Creates attachment upload tools for use in agents
 */
export function createAttachmentTools(client: FikenClient, pendingFiles?: PendingFile[]) {
  
  // ============================================
  // PURCHASE ATTACHMENTS
  // ============================================
  
  const uploadAttachmentToPurchase = tool({
    description: "Last opp vedlagte fil(er) til et kjøp. Brukes etter createPurchase for å legge ved dokumentasjon. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig kjøp.",
    parameters: z.object({
      purchaseId: z.number().describe("Kjøps-ID fra createPurchase"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ purchaseId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        // Check existing attachments to avoid duplicates
        let existingAttachmentCount = 0;
        try {
          const existing = await client.getPurchaseAttachments(purchaseId);
          existingAttachmentCount = existing.length;
        } catch {
          // If we can't check, proceed anyway
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToPurchase(purchaseId, formData);
        const formDataOptions = { attachToSale: true };
        
        // If fileIndex is specified, upload only that specific file
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          
          // Skip if purchase already has attachments (avoid duplicates on retry)
          if (existingAttachmentCount > 0) {
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 0,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Kjøp ${purchaseId} har allerede ${existingAttachmentCount} vedlegg — hopper over (duplikatbeskyttelse)`,
              skipped: true,
            };
          }
          
          try {
            const result = await uploadSingleFile(file, uploadFn, formDataOptions);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til kjøp ${purchaseId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        // Upload all files (skip if purchase already has attachments)
        if (existingAttachmentCount > 0) {
          return {
            success: true,
            fileUploaded: true,
            filesUploaded: 0,
            totalFiles: pendingFiles.length,
            message: `Kjøp ${purchaseId} har allerede ${existingAttachmentCount} vedlegg — ingen nye opplastinger (duplikatbeskyttelse)`,
            skipped: true,
          };
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn, formDataOptions);
        
        if (uploaded.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: uploaded.length === pendingFiles.length 
            ? `Alle ${uploaded.length} vedlegg lastet opp til kjøp ${purchaseId}`
            : `${uploaded.length} av ${pendingFiles.length} vedlegg lastet opp til kjøp ${purchaseId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til kjøp",
        };
      }
    },
  });

  // ============================================
  // SALE ATTACHMENTS
  // ============================================

  const uploadAttachmentToSale = tool({
    description: "Last opp vedlagte fil(er) til et salg. Brukes etter createSale for å legge ved dokumentasjon. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig salg.",
    parameters: z.object({
      saleId: z.number().describe("Salgs-ID fra createSale"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ saleId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToSale(saleId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til salg ${saleId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: uploaded.length === pendingFiles.length 
            ? `Alle ${uploaded.length} vedlegg lastet opp til salg ${saleId}`
            : `${uploaded.length} av ${pendingFiles.length} vedlegg lastet opp til salg ${saleId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til salg",
        };
      }
    },
  });

  // ============================================
  // INVOICE ATTACHMENTS
  // ============================================

  const uploadAttachmentToInvoice = tool({
    description: "Last opp vedlagte fil(er) til en faktura. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig faktura.",
    parameters: z.object({
      invoiceId: z.number().describe("Faktura-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ invoiceId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToInvoice(invoiceId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til faktura ${invoiceId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: uploaded.length === pendingFiles.length 
            ? `Alle ${uploaded.length} vedlegg lastet opp til faktura ${invoiceId}`
            : `${uploaded.length} av ${pendingFiles.length} vedlegg lastet opp til faktura ${invoiceId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til faktura",
        };
      }
    },
  });

  // ============================================
  // JOURNAL ENTRY ATTACHMENTS
  // ============================================

  const uploadAttachmentToJournalEntry = tool({
    description: "Last opp vedlagte fil(er) til et bilag (journal entry). KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen. Ved flere filer: bruk fileIndex for å laste opp spesifikk fil til riktig bilag.",
    parameters: z.object({
      journalEntryId: z.number().describe("Bilags-ID (journal entry ID)"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert, matcher 'Fil 1', 'Fil 2' osv.). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ journalEntryId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToJournalEntry(journalEntryId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til bilag ${journalEntryId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: uploaded.length === pendingFiles.length 
            ? `Alle ${uploaded.length} vedlegg lastet opp til bilag ${journalEntryId}`
            : `${uploaded.length} av ${pendingFiles.length} vedlegg lastet opp til bilag ${journalEntryId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til bilag",
        };
      }
    },
  });

  // ============================================
  // CONTACT ATTACHMENTS
  // ============================================

  const uploadAttachmentToContact = tool({
    description: "Last opp vedlagte fil(er) til en kontakt. KRITISK: Kan kun brukes når brukeren har sendt fil(er) sammen med meldingen.",
    parameters: z.object({
      contactId: z.number().describe("Kontakt-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ contactId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) (bilde/PDF) sammen med meldingen for å bruke dette verktøyet.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToContact(contactId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              fileUploaded: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              fileIndex: fileIndex,
              message: `Fil ${fileIndex} (${file.name}) lastet opp til kontakt ${contactId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil ${fileIndex} (${file.name}): ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return {
            success: false,
            error: `Kunne ikke laste opp noen filer: ${errors.join("; ")}`,
          };
        }
        
        return {
          success: true,
          fileUploaded: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: uploaded.length === pendingFiles.length 
            ? `Alle ${uploaded.length} vedlegg lastet opp til kontakt ${contactId}`
            : `${uploaded.length} av ${pendingFiles.length} vedlegg lastet opp til kontakt ${contactId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg til kontakt",
        };
      }
    },
  });

  // ============================================
  // DRAFT ATTACHMENTS
  // ============================================

  const uploadAttachmentToInvoiceDraft = tool({
    description: "Last opp vedlagte fil(er) til et fakturautkast.",
    parameters: z.object({
      draftId: z.number().describe("Fakturautkast-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ draftId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) sammen med meldingen.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToInvoiceDraft(draftId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              message: `Fil ${fileIndex} lastet opp til fakturautkast ${draftId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil: ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return { success: false, error: `Kunne ikke laste opp: ${errors.join("; ")}` };
        }
        
        return {
          success: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: `${uploaded.length} vedlegg lastet opp til fakturautkast ${draftId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg",
        };
      }
    },
  });

  const uploadAttachmentToCreditNoteDraft = tool({
    description: "Last opp vedlagte fil(er) til et kreditnotautkast.",
    parameters: z.object({
      draftId: z.number().describe("Kreditnotautkast-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ draftId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) sammen med meldingen.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToCreditNoteDraft(draftId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              message: `Fil ${fileIndex} lastet opp til kreditnotautkast ${draftId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil: ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return { success: false, error: `Kunne ikke laste opp: ${errors.join("; ")}` };
        }
        
        return {
          success: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: `${uploaded.length} vedlegg lastet opp til kreditnotautkast ${draftId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg",
        };
      }
    },
  });

  const uploadAttachmentToPurchaseDraft = tool({
    description: "Last opp vedlagte fil(er) til et kjøpsutkast.",
    parameters: z.object({
      draftId: z.number().describe("Kjøpsutkast-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ draftId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) sammen med meldingen.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToPurchaseDraft(draftId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              message: `Fil ${fileIndex} lastet opp til kjøpsutkast ${draftId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil: ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return { success: false, error: `Kunne ikke laste opp: ${errors.join("; ")}` };
        }
        
        return {
          success: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: `${uploaded.length} vedlegg lastet opp til kjøpsutkast ${draftId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg",
        };
      }
    },
  });

  const uploadAttachmentToOfferDraft = tool({
    description: "Last opp vedlagte fil(er) til et tilbudsutkast.",
    parameters: z.object({
      draftId: z.number().describe("Tilbudsutkast-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ draftId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) sammen med meldingen.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToOfferDraft(draftId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              message: `Fil ${fileIndex} lastet opp til tilbudsutkast ${draftId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil: ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return { success: false, error: `Kunne ikke laste opp: ${errors.join("; ")}` };
        }
        
        return {
          success: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: `${uploaded.length} vedlegg lastet opp til tilbudsutkast ${draftId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg",
        };
      }
    },
  });

  const uploadAttachmentToOrderConfirmationDraft = tool({
    description: "Last opp vedlagte fil(er) til et ordrebekreftelse-utkast.",
    parameters: z.object({
      draftId: z.number().describe("Ordrebekreftelse-utkast-ID"),
      fileIndex: z.number().optional().describe("Hvilken fil som skal lastes opp (1-basert). Hvis ikke angitt, lastes ALLE filer opp."),
    }),
    execute: async ({ draftId, fileIndex }) => {
      try {
        if (!pendingFiles || pendingFiles.length === 0) {
          return {
            success: false,
            error: "Ingen filer vedlagt. Brukeren må sende fil(er) sammen med meldingen.",
          };
        }
        
        const uploadFn = (formData: FormData) => client.addAttachmentToOrderConfirmationDraft(draftId, formData);
        
        if (fileIndex !== undefined) {
          const arrayIndex = fileIndex - 1;
          if (arrayIndex < 0 || arrayIndex >= pendingFiles.length) {
            return {
              success: false,
              error: `Ugyldig fileIndex: ${fileIndex}. Må være mellom 1 og ${pendingFiles.length}.`,
            };
          }
          
          const file = pendingFiles[arrayIndex];
          try {
            const result = await uploadSingleFile(file, uploadFn);
            return {
              success: true,
              filesUploaded: 1,
              totalFiles: pendingFiles.length,
              message: `Fil ${fileIndex} lastet opp til ordrebekreftelse-utkast ${draftId}`,
              uploadedFiles: [result],
            };
          } catch (error) {
            return {
              success: false,
              error: `Kunne ikke laste opp fil: ${error instanceof Error ? error.message : "Ukjent feil"}`,
            };
          }
        }
        
        const { uploaded, errors } = await uploadMultipleFiles(pendingFiles, uploadFn);
        
        if (uploaded.length === 0) {
          return { success: false, error: `Kunne ikke laste opp: ${errors.join("; ")}` };
        }
        
        return {
          success: true,
          filesUploaded: uploaded.length,
          totalFiles: pendingFiles.length,
          message: `${uploaded.length} vedlegg lastet opp til ordrebekreftelse-utkast ${draftId}`,
          uploadedFiles: uploaded,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Kunne ikke laste opp vedlegg",
        };
      }
    },
  });

  // Return all attachment tools
  return {
    // Main document attachments
    uploadAttachmentToPurchase,
    uploadAttachmentToSale,
    uploadAttachmentToInvoice,
    uploadAttachmentToJournalEntry,
    uploadAttachmentToContact,
    
    // Draft attachments
    uploadAttachmentToInvoiceDraft,
    uploadAttachmentToCreditNoteDraft,
    uploadAttachmentToPurchaseDraft,
    uploadAttachmentToOfferDraft,
    uploadAttachmentToOrderConfirmationDraft,
  };
}

// Export type for the attachment tools
export type AttachmentTools = ReturnType<typeof createAttachmentTools>;

// Helper to get pending files info (for debugging/display)
export function getPendingFilesInfo(pendingFiles?: PendingFile[]): { count: number; files: Array<{ name: string; type: string }> } | null {
  if (!pendingFiles || pendingFiles.length === 0) {
    return null;
  }
  return {
    count: pendingFiles.length,
    files: pendingFiles.map(f => ({ name: f.name, type: f.type })),
  };
}
