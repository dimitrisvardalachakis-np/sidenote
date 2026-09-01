import {
  EMPTY_UPLOAD_VALUES,
  type UploadFieldErrors,
  type UploadFormValues,
} from "@/lib/schemas/document-upload";

/**
 * State threaded between the upload panel and its Server Action.
 *
 * In its own module because a `"use server"` file may only export async
 * functions — anything else silently arrives as `undefined` on the client.
 * Learned the hard way in step 5.
 */
export interface UploadState {
  readonly status: "idle" | "invalid" | "rejected" | "saved" | "error" | "duplicate";
  readonly errors: UploadFieldErrors;
  readonly values: UploadFormValues;
  /** Set when a document was accepted, so the panel can confirm it. */
  readonly saved: {
    readonly title: string;
    readonly chunkCount: number;
    readonly objectKey: string;
  } | null;
  /**
   * What this upload collided with, when it did.
   *
   * Carried as data rather than folded into `errors.form`, because the panel
   * has two different things to render from it: a refusal the reviewer cannot
   * argue with (identical text), and a warning they can acknowledge (same
   * substance, kind and version). Only the second offers the confirm, and the
   * panel decides that from `kind` rather than by matching on message text.
   */
  readonly duplicate: {
    readonly kind: "same_content" | "same_version";
    readonly message: string;
    readonly heldTitle: string;
    readonly heldDocumentId: string;
  } | null;
}

export const INITIAL_UPLOAD_STATE: UploadState = {
  status: "idle",
  errors: {},
  values: EMPTY_UPLOAD_VALUES,
  saved: null,
  duplicate: null,
};
