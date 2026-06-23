import 'dotenv/config';
import bcrypt from 'bcrypt';
import { connectDB } from '../config/mysql.js';
import Doctor from '../models/doctorModel.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve image paths from the frontend assets directory
const assetsDir = path.resolve(__dirname, '../../frontend/src/assets');

/**
 * Read an image file and convert it to a base64 data URI so it can be stored
 * directly in the database (matching how the admin panel uploads work).
 */
function imageToDataUri(filename) {
  const filePath = path.join(assetsDir, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: Image not found at ${filePath}, using placeholder`);
    return 'https://res.cloudinary.com/demo/image/upload/v1690000000/sample.jpg';
  }
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  return `data:image/png;base64,${base64}`;
}

const doctorsData = [
  {
    name: 'Dr. Richard James',
    image: 'doc1.png',
    email: 'richard.james@appointy.com',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '4 Years',
    about:
      'Dr. Richard James has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address: { line1: '17th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Emily Larson',
    image: 'doc2.png',
    email: 'emily.larson@appointy.com',
    speciality: 'Gynecologist',
    degree: 'MBBS',
    experience: '3 Years',
    about:
      'Dr. Emily Larson is dedicated to providing exceptional women\'s healthcare with a focus on patient comfort, thorough diagnosis, and personalized treatment plans.',
    fees: 60,
    address: { line1: '27th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Sarah Patel',
    image: 'doc3.png',
    email: 'sarah.patel@appointy.com',
    speciality: 'Dermatologist',
    degree: 'MBBS',
    experience: '1 Years',
    about:
      'Dr. Sarah Patel specializes in diagnosing and treating skin conditions with a patient-centered approach, utilizing the latest dermatological techniques and treatments.',
    fees: 30,
    address: { line1: '37th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Christopher Lee',
    image: 'doc4.png',
    email: 'christopher.lee@appointy.com',
    speciality: 'Pediatricians',
    degree: 'MBBS',
    experience: '2 Years',
    about:
      'Dr. Christopher Lee is passionate about children\'s health, providing gentle and thorough pediatric care from infancy through adolescence.',
    fees: 40,
    address: { line1: '47th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Jennifer Garcia',
    image: 'doc5.png',
    email: 'jennifer.garcia@appointy.com',
    speciality: 'Neurologist',
    degree: 'MBBS',
    experience: '4 Years',
    about:
      'Dr. Jennifer Garcia brings extensive expertise in neurological disorders, offering advanced diagnostic and treatment options for complex neurological conditions.',
    fees: 50,
    address: { line1: '57th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Andrew Williams',
    image: 'doc6.png',
    email: 'andrew.williams@appointy.com',
    speciality: 'Neurologist',
    degree: 'MBBS',
    experience: '4 Years',
    about:
      'Dr. Andrew Williams is a skilled neurologist with deep expertise in treating disorders of the nervous system, committed to improving patient outcomes through evidence-based care.',
    fees: 50,
    address: { line1: '57th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Christopher Davis',
    image: 'doc7.png',
    email: 'christopher.davis@appointy.com',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '4 Years',
    about:
      'Dr. Christopher Davis has a strong commitment to delivering comprehensive medical care, focusing on preventive medicine, early diagnosis, and effective treatment strategies.',
    fees: 50,
    address: { line1: '17th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Timothy White',
    image: 'doc8.png',
    email: 'timothy.white@appointy.com',
    speciality: 'Gynecologist',
    degree: 'MBBS',
    experience: '3 Years',
    about:
      'Dr. Timothy White provides expert gynecological care with a compassionate approach, specializing in preventive screenings and minimally invasive procedures.',
    fees: 60,
    address: { line1: '27th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Ava Mitchell',
    image: 'doc9.png',
    email: 'ava.mitchell@appointy.com',
    speciality: 'Dermatologist',
    degree: 'MBBS',
    experience: '1 Years',
    about:
      'Dr. Ava Mitchell is a dedicated dermatologist focused on providing personalized skincare solutions, from medical dermatology to cosmetic treatments.',
    fees: 30,
    address: { line1: '37th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Jeffrey King',
    image: 'doc10.png',
    email: 'jeffrey.king@appointy.com',
    speciality: 'Pediatricians',
    degree: 'MBBS',
    experience: '2 Years',
    about:
      'Dr. Jeffrey King is committed to providing comprehensive pediatric care, ensuring the health and well-being of children through attentive and compassionate medical practice.',
    fees: 40,
    address: { line1: '47th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Zoe Kelly',
    image: 'doc11.png',
    email: 'zoe.kelly@appointy.com',
    speciality: 'Neurologist',
    degree: 'MBBS',
    experience: '4 Years',
    about:
      'Dr. Zoe Kelly is an experienced neurologist who specializes in diagnosing and managing a wide range of neurological conditions with a patient-first philosophy.',
    fees: 50,
    address: { line1: '57th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Patrick Harris',
    image: 'doc12.png',
    email: 'patrick.harris@appointy.com',
    speciality: 'Gastroenterologist',
    degree: 'MBBS',
    experience: '4 Years',
    about:
      'Dr. Patrick Harris is a gastroenterology specialist focused on digestive health, offering expert diagnosis and treatment for gastrointestinal disorders.',
    fees: 50,
    address: { line1: '57th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Chloe Evans',
    image: 'doc13.png',
    email: 'chloe.evans@appointy.com',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '4 Years',
    about:
      'Dr. Chloe Evans provides holistic primary care with a focus on long-term patient wellness, preventive health measures, and chronic disease management.',
    fees: 50,
    address: { line1: '17th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Ryan Martinez',
    image: 'doc14.png',
    email: 'ryan.martinez@appointy.com',
    speciality: 'Gynecologist',
    degree: 'MBBS',
    experience: '3 Years',
    about:
      'Dr. Ryan Martinez offers comprehensive gynecological services with a focus on reproductive health, preventive care, and patient education.',
    fees: 60,
    address: { line1: '27th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
  {
    name: 'Dr. Amelia Hill',
    image: 'doc15.png',
    email: 'amelia.hill@appointy.com',
    speciality: 'Dermatologist',
    degree: 'MBBS',
    experience: '1 Years',
    about:
      'Dr. Amelia Hill is a compassionate dermatologist committed to helping patients achieve healthy skin through evidence-based treatments and preventive care strategies.',
    fees: 30,
    address: { line1: '37th Cross, Richmond', line2: 'Circle, Ring Road, London' },
  },
];

async function seedDoctors() {
  await connectDB();

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash('doctor123', salt);

  const rows = doctorsData.map((doc) => ({
    name: doc.name,
    email: doc.email,
    image: imageToDataUri(doc.image),
    speciality: doc.speciality,
    degree: doc.degree,
    experience: doc.experience,
    about: doc.about,
    fees: doc.fees,
    address: doc.address,
    available: true,
    slots_booked: {},
    date: Date.now(),
    password: hashedPassword,
  }));

  await Doctor.bulkCreate(rows, {
    ignoreDuplicates: true,
  });

  const count = await Doctor.count();
  console.log(`Seeded ${rows.length} doctors. Total doctors in DB: ${count}`);
}

seedDoctors()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
