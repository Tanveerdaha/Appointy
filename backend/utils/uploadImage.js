import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';

const hasCloudinaryConfig =
  process.env.CLOUDINARY_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET &&
  !['demo', 'demo_key', 'demo_secret', 'your_cloudinary_name'].includes(
    process.env.CLOUDINARY_NAME
  );

export const uploadImage = async (imageFile) => {
  if (hasCloudinaryConfig) {
    try {
      const imageUpload = await cloudinary.uploader.upload(imageFile.path, {
        resource_type: 'image',
      });
      return imageUpload.secure_url;
    } catch (error) {
      console.warn('Cloudinary upload failed, using local storage:', error.message);
    }
  }

  const imageBuffer = fs.readFileSync(imageFile.path);
  const base64Image = `data:${imageFile.mimetype};base64,${imageBuffer.toString('base64')}`;

  if (fs.existsSync(imageFile.path)) {
    fs.unlinkSync(imageFile.path);
  }

  return base64Image;
};
