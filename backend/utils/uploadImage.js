import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';

const hasCloudinaryConfig = () => {
  const name = process.env.CLOUDINARY_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;

  if (!name || !key || !secret) return false;

  const placeholders = [
    'your_cloudinary_cloud_name',
    'your_cloudinary_name',
    'your_cloudinary_api_key',
    'your_cloudinary_api_secret',
    'demo',
    'demo_key',
    'demo_secret',
  ];

  return ![name, key, secret].some((value) => placeholders.includes(value));
};

const cleanupTempFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

/** Upload an image to Cloudinary only. Local/base64 storage is not used. */
export const uploadImage = async (imageFile) => {
  if (!imageFile?.path) {
    throw new Error('No image file provided');
  }

  if (!hasCloudinaryConfig()) {
    cleanupTempFile(imageFile.path);
    throw new Error(
      'Cloudinary is not configured. Set CLOUDINARY_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in backend/.env'
    );
  }

  try {
    const imageUpload = await cloudinary.uploader.upload(imageFile.path, {
      resource_type: 'image',
      folder: 'appointy',
    });
    return imageUpload.secure_url;
  } catch (error) {
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  } finally {
    cleanupTempFile(imageFile.path);
  }
};
