import { diskStorage } from 'multer';
import { extname } from 'path';

export const multerOptions = {
  storage: diskStorage({
    destination: './uploads', // Make sure this folder exists
    filename: (req, file, callback) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = extname(file.originalname);
      callback(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  }),
  fileFilter: (req, file, callback) => {
    if (!file.originalname.match(/\.(pdf|doc|docx|txt|ppt|pptx|md|markdown|png|jpg|jpeg|webp)$/i)) {
      return callback(new Error('Only document and image files (PDF, DOC, DOCX, TXT, PPT, PPTX, MD, PNG, JPG, JPEG, WEBP) are allowed!'), false);
    }
    callback(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024, 
  },
};
