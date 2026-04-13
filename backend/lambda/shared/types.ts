export interface UploadRecord {
  uploadId: string;
  status: "pending" | "confirmed";
  filename: string;
  sizeBytes: number;
  contentType: string;
  s3Key: string;
  sourceIp: string;
  createdAt: string;
  confirmedAt?: string;
  userEmail?: string;
  userName?: string;
  repoUrl?: string;
  notes?: string;
}
