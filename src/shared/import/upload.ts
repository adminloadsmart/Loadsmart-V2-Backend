import { RequestHandler, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { ValidationError } from '../errors';
import { ImportFileType } from './parse';

/** Bulk-upload limits for every master import. Rows are created one by one inside the request. */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;

const EXTENSIONS: Record<string, ImportFileType> = { '.xlsx': 'xlsx', '.csv': 'csv' };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const extensionOf = (name: string) => name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, callback: FileFilterCallback) => {
    const extension = extensionOf(file.originalname);
    if (extension === '.xls')
      callback(
        new ValidationError('.xls files are not supported — save the sheet as .xlsx or .csv'),
      );
    else if (!(extension in EXTENSIONS))
      callback(new ValidationError('Only .xlsx or .csv files are accepted'));
    else callback(null, true);
  },
});

/** upload.single('file') with multer's own errors (size, extra files) turned into a 400. */
export const importUpload: RequestHandler = (req, res, next) =>
  upload.single('file')(req, res, (error?: unknown) => {
    if (error instanceof multer.MulterError) {
      next(
        new ValidationError(
          error.code === 'LIMIT_FILE_SIZE'
            ? `File is larger than ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB`
            : error.message,
        ),
      );
      return;
    }
    next(error);
  });

export const requireImportFile: RequestHandler = (req, _res, next) => {
  if (!req.file) {
    next(new ValidationError('An .xlsx or .csv file is required in the "file" form field'));
    return;
  }
  next();
};

export interface ImportSource {
  fileName: string;
  fileType: ImportFileType;
  buffer: Buffer;
}

/** The upload as import services read it; importUpload already allowed only .xlsx/.csv. */
export function importSource(file: Express.Multer.File): ImportSource {
  return {
    fileName: file.originalname,
    fileType: EXTENSIONS[extensionOf(file.originalname)] ?? 'xlsx',
    buffer: file.buffer,
  };
}

/** Sends a generated template as a download. */
export function sendXlsx(res: Response, filename: string, body: Buffer): void {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}
