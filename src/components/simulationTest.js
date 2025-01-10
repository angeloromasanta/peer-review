// simulationTest.js
import { db } from '../firebase';
import {
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const PLACEHOLDER_IMAGE_URLS = [
  '/api/placeholder/400/300',
  '/api/placeholder/400/300',
  '/api/placeholder/400/300'
];

const generateTestData = (index) => {
  const topics = ['Machine Learning', 'Web Development', 'Data Science', 'Mobile Apps', 'Cloud Computing'];
  const randomTopic = topics[Math.floor(Math.random() * topics.length)];
  
  return {
    studentName: `Test Student ${index + 1}`,
    studentEmail: `student${index + 1}@test.com`,
    content: `Here's my submission about ${randomTopic}!\n\nI've been studying ${randomTopic} for the past few months and wanted to share my thoughts. This field is incredibly fascinating because it combines theoretical knowledge with practical applications.\n\nOne of the most interesting aspects I've discovered is how ${randomTopic} is transforming various industries. For example...\n\nIn conclusion, I believe ${randomTopic} will continue to evolve and shape our future in unexpected ways.`,
    images: PLACEHOLDER_IMAGE_URLS.slice(0, Math.floor(Math.random() * 3) + 1) // Random 1-3 images
  };
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const openStudentTab = async (studentData, activityId) => {
  // Create URL with student data
  const params = new URLSearchParams({
    simulate: 'true',
    studentName: studentData.studentName,
    studentEmail: studentData.studentEmail,
    activityId: activityId
  });
  
  // Open new tab with student data
  window.open(`/student?${params.toString()}`, `student_${studentData.studentEmail}`);
  
  // Add small delay to prevent overwhelming the browser
  await delay(100);
};

export const runSimulation = async (activityId) => {
  if (!activityId) return;
  
  try {
    console.log('Starting simulation for activity:', activityId);
    const activityRef = doc(db, 'activities', activityId);
    const activityDoc = await getDoc(activityRef);
    
    if (!activityDoc.exists()) {
      console.error('Activity not found');
      return;
    }

    // Create 30 test submissions
    const batch = writeBatch(db);
    const submissionRefs = [];
    const studentData = [];

    for (let i = 0; i < 30; i++) {
      const testData = generateTestData(i);
      studentData.push(testData);
      
      // Create student document
      const studentRef = doc(collection(db, 'students'));
      batch.set(studentRef, {
        name: testData.studentName,
        email: testData.studentEmail,
        studentId: i + 1,
        createdAt: new Date()
      });

      // Create submission document
      const submissionRef = doc(collection(db, 'submissions'));
      batch.set(submissionRef, {
        activityId,
        studentName: testData.studentName,
        studentEmail: testData.studentEmail,
        studentId: i + 1,
        content: testData.content,
        images: testData.images,
        timestamp: new Date(),
        status: 'submitted',
        version: '1.0'
      });

      submissionRefs.push(submissionRef.id);
    }

    // Update activity with submission refs
    batch.update(activityRef, {
      submissions: submissionRefs
    });

    await batch.commit();
    console.log('Data simulation completed successfully');

    // Ask user before opening tabs
    const openTabs = window.confirm(
      'Simulation data has been created. Would you like to open browser tabs for all 30 students?'
    );

    if (openTabs) {
      console.log('Opening student tabs...');
      for (const data of studentData) {
        await openStudentTab(data, activityId);
      }
      console.log('All student tabs opened');
    }

  } catch (error) {
    console.error('Error running simulation:', error);
    throw error;
  }
};