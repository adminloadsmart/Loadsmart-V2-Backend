import multer, { FileFilterCallback } from 'multer';
import { ValidationError } from '../../shared/errors';

export const mastersExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback: FileFilterCallback) => {
    if (!file.originalname.toLowerCase().endsWith('.xlsx'))
      callback(new Error('Only .xlsx files are accepted'));
    else callback(null, true);
  },
});

export function requireMastersExcelFile(
  req: Parameters<import('express').RequestHandler>[0],
  _res: Parameters<import('express').RequestHandler>[1],
  next: Parameters<import('express').RequestHandler>[2],
) {
  if (!req.file) {
    next(new ValidationError('An Excel file is required in the "file" form field'));
    return;
  }
  next();
}
