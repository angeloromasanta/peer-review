//Student.jsx
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,  // Add this import
  doc,     // Add this import
  onSnapshot,
  limit,
  orderBy,
  arrayUnion,
  updateDoc,
} from 'firebase/firestore';
import _ from 'lodash';
import {
  getStorage, ref, uploadBytes, getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { runEvaluationRound } from './evaluationManager';


function Student() {
  // State declarations
  const [phase, setPhase] = useState('wait');
  const [currentActivity, setCurrentActivity] = useState(null);
  const [studentName, setStudentName] = useState(() => localStorage.getItem('studentName') || '');
  const [studentEmail, setStudentEmail] = useState(() => localStorage.getItem('studentEmail') || '');
  const [submission, setSubmission] = useState('');
  const [evaluationPair, setEvaluationPair] = useState(null);
  const [leftComments, setLeftComments] = useState('');
  const [rightComments, setRightComments] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [evaluationSubmitted, setEvaluationSubmitted] = useState(false);
  const [receivedEvaluations, setReceivedEvaluations] = useState([]);
  const [textContent, setTextContent] = useState('');
  const [feedbackGiven, setFeedbackGiven] = useState([]);
  const [starredEvaluations, setStarredEvaluations] = useState([]);
  const [images, setImages] = useState([]);
  const [tempImageUrls, setTempImageUrls] = useState([]); // Temporary URLs for preview


  const storage = getStorage();
  const [studentId, setStudentId] = useState(() =>
    localStorage.getItem('studentId') ? Number(localStorage.getItem('studentId')) : null
  );

  const getSubmissionContent = () => {
    return {
      text: textContent,
      images: images
    };
  };

  const [contentState, setContentState] = useState({
    text: '',
    images: []
  });

  // Persistence effect
  useEffect(() => {
    if (studentName) localStorage.setItem('studentName', studentName);
    if (studentEmail) localStorage.setItem('studentEmail', studentEmail);
    if (studentId) localStorage.setItem('studentId', studentId.toString());
  }, [studentName, studentEmail, studentId]);



  useEffect(() => {
    const q = query(
      collection(db, 'activities'),
      where('isActive', '==', true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        console.log('No active activity found - resetting state');
        setPhase('wait');
        setCurrentActivity(null);
        setStudentName('');
        setStudentEmail('');
        setSubmission('');
        setEvaluationPair(null);
        setLeftComments('');
        setRightComments('');
        setSubmitted(false);
        setEvaluationSubmitted(false);
        setReceivedEvaluations([]);
        setStudentId(null);
        localStorage.clear();
        return;
      }

      const activity = {
        id: snapshot.docs[0].id,
        ...snapshot.docs[0].data(),
      };
      console.log('Active activity updated:', activity);

      setCurrentActivity(activity);
      setPhase(activity.phase);

      // Reset evaluation state when round changes
      if (activity.currentRound !== currentActivity?.currentRound) {
        console.log('Round changed from', currentActivity?.currentRound, 'to', activity.currentRound);
        setEvaluationSubmitted(false);
        setEvaluationPair(null);
        setLeftComments('');
        setRightComments('');
      }
    });

    return () => unsubscribe();
  }, [currentActivity?.currentRound]);

  useEffect(() => {
    if (!currentActivity || phase !== 'final' || !studentEmail) return;

    const q = query(
      collection(db, 'evaluations'),
      where('evaluatorEmail', '==', studentEmail),
      where('activityId', '==', currentActivity.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const evaluations = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setFeedbackGiven(evaluations);
    });

    return () => unsubscribe();
  }, [currentActivity, phase, studentEmail]);


  const handleStarToggle = async (evaluationId, currentStars = []) => {
    console.log('Star toggle triggered:', {
      evaluationId,
      currentStars,
      studentEmail
    });
  
    try {
      // Get the current evaluation document to ensure we have latest stars
      const evaluationRef = doc(db, 'evaluations', evaluationId);
      const evaluationDoc = await getDoc(evaluationRef);
      
      if (!evaluationDoc.exists()) {
        console.error('Evaluation not found');
        return;
      }
  
      // Get current stars from the document
      const existingStars = evaluationDoc.data().stars || [];
      
      // Check if user has already starred
      const hasStarred = existingStars.includes(studentEmail);
  
      // Add or remove the star while preserving other stars
      let updatedStars;
      if (hasStarred) {
        updatedStars = existingStars.filter(email => email !== studentEmail);
      } else {
        updatedStars = [...existingStars, studentEmail];
      }
  
      console.log('Updating stars:', {
        existingStars,
        updatedStars,
        hasStarred
      });
  
      // Update Firestore
      await updateDoc(evaluationRef, {
        stars: updatedStars
      });
  
      // Update local state
      setReceivedEvaluations(prevEvaluations =>
        prevEvaluations.map(evaluation =>
          evaluation.evaluationId === evaluationId
            ? { ...evaluation, stars: updatedStars }
            : evaluation
        )
      );
      
      console.log('Star update successful', {
        evaluationId,
        updatedStars
      });
      
    } catch (error) {
      console.error('Error updating star:', error);
    }
  };


  const handlePaste = async (e) => {
    console.log('Paste event triggered');
    const items = e.clipboardData?.items;

    if (!items) {
      console.log('No clipboard items found');
      return;
    }

    // Log all clipboard items
    console.log('All clipboard items:', Array.from(items).map(item => ({
      kind: item.kind,
      type: item.type
    })));

    // First check for direct image paste
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        console.log('Found direct image paste');
        await handleDirectImagePaste(item);
        return;
      }
    }

    // If no direct image, check for HTML content
    const htmlItem = Array.from(items).find(item => item.type === 'text/html');
    if (htmlItem) {
      console.log('Found HTML content, checking for image');
      htmlItem.getAsString(async (htmlString) => {
        console.log('HTML content:', htmlString);

        // Create a temporary element to parse the HTML
        const temp = document.createElement('div');
        temp.innerHTML = htmlString;

        // Find all img elements in the pasted HTML
        const images = temp.getElementsByTagName('img');
        console.log('Found images in HTML:', images.length);

        if (images.length > 0) {
          // Prevent default paste for images
          e.preventDefault();

          for (const img of images) {
            const imgSrc = img.src;
            console.log('Processing image with src:', imgSrc);

            try {
              // Fetch the image
              const response = await fetch(imgSrc);
              console.log('Fetch response:', response.status);
              if (!response.ok) throw new Error('Failed to fetch image');

              const blob = await response.blob();
              console.log('Got blob:', blob.type, blob.size);

              // Create a file from the blob
              const file = new File([blob], `pasted-image-${Date.now()}.png`, {
                type: blob.type || 'image/png'
              });

              // Upload to Firebase
              await handleImageFile(file);
            } catch (error) {
              console.error('Error processing HTML image:', error);
            }
          }
        }
      });
    }
  };

  const handleDirectImagePaste = async (item) => {
    const file = item.getAsFile();
    if (!file) {
      console.log('No file in clipboard item');
      return;
    }

    console.log('Image file details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    await handleImageFile(file);
  };

  const handleImageFile = async (file) => {
    try {
      // Generate a preview using FileReader
      const reader = new FileReader();
      reader.onload = async (event) => {
        console.log('FileReader loaded');
        const base64data = event.target.result;
        console.log('Generated base64 data of length:', base64data.length);

        const pasteId = Date.now();

        // Create placeholder with base64 preview
        const imgPlaceholder = `<img 
        src="${base64data}" 
        id="paste-${pasteId}"
        class="max-w-full h-auto my-2 opacity-50 transition-opacity" 
        alt="Uploading..." 
      />`;

        // Insert the placeholder
        setTextContent(prev => prev + imgPlaceholder);

        try {
          // Upload to Firebase
          console.log('Starting Firebase upload');
          const filename = `paste-${pasteId}.png`;
          const storageRef = ref(storage, `temp/${studentEmail}/${filename}`);

          const metadata = {
            contentType: file.type || 'image/png',
            customMetadata: {
              uploadedBy: studentEmail
            }
          };

          const snapshot = await uploadBytes(storageRef, file, metadata);
          console.log('Upload completed:', snapshot);

          const firebaseUrl = await getDownloadURL(snapshot.ref);
          console.log('Got Firebase URL:', firebaseUrl);

          // Track the URL
          setTempImageUrls(prev => [...prev, firebaseUrl]);

          // Update the image source
          const imgElement = document.getElementById(`paste-${pasteId}`);
          if (imgElement) {
            imgElement.src = firebaseUrl;
            imgElement.classList.remove('opacity-50');
            // Update content state
            const editableDiv = document.querySelector('[contenteditable]');
            if (editableDiv) {
              setTextContent(editableDiv.innerHTML);
            }
          }
        } catch (error) {
          console.error('Firebase upload error:', error);
          const imgElement = document.getElementById(`paste-${pasteId}`);
          if (imgElement) {
            imgElement.remove();
            const editableDiv = document.querySelector('[contenteditable]');
            if (editableDiv) {
              setTextContent(editableDiv.innerHTML);
            }
          }
          alert('Failed to upload image. Please try again.');
        }
      };

      reader.onerror = (error) => {
        console.error('FileReader error:', error);
      };

      console.log('Starting FileReader');
      reader.readAsDataURL(file);

    } catch (error) {
      console.error('Top level error in handleImageFile:', error);
      alert('Failed to process image. Please try again.');
    }
  };

  const ContentEditable = () => {
    console.log('Rendering ContentEditable, current content length:', textContent.length);

    return (
      <div
        className="border p-2 w-full min-h-32 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        contentEditable
        suppressContentEditableWarning={true}
        onPaste={handlePaste}
        onInput={(e) => {
          console.log('Content changed');
          const content = e.currentTarget.innerHTML;
          console.log('New content length:', content.length);
          setTextContent(content);
        }}
        dangerouslySetInnerHTML={{ __html: textContent }}
        role="textbox"
        aria-multiline="true"
      />
    );
  };



  // Handle submission


  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!currentActivity || submitted) return;

    try {
      console.log('Starting submission process:', { studentName, studentEmail });

      // 1. Validate input
      if (!studentName.trim() || !studentEmail.trim() || !textContent.trim()) {
        throw new Error('Please fill in all required fields');
      }

      // 2. Check for existing submissions
      const existingSubmissions = await getDocs(
        query(
          collection(db, 'submissions'),
          where('activityId', '==', currentActivity.id),
          where('studentEmail', '==', studentEmail)
        )
      );

      if (!existingSubmissions.empty) {
        console.log('Already submitted for this activity');
        setSubmitted(true);
        const submission = existingSubmissions.docs[0].data();
        setStudentId(submission.studentId);
        return;
      }

      // 3. Get or create student ID
      let studentId;
      const studentQuery = query(
        collection(db, 'students'),
        where('email', '==', studentEmail)
      );
      const studentSnapshot = await getDocs(studentQuery);

      if (!studentSnapshot.empty) {
        studentId = studentSnapshot.docs[0].data().studentId;
      } else {
        // Create new student ID
        const allStudentsQuery = query(
          collection(db, 'students'),
          orderBy('studentId', 'desc'),
          limit(1)
        );
        const allStudentsSnapshot = await getDocs(allStudentsQuery);
        studentId = (allStudentsSnapshot.empty ? 0 : allStudentsSnapshot.docs[0].data().studentId) + 1;

        await addDoc(collection(db, 'students'), {
          email: studentEmail,
          name: studentName,
          studentId: studentId,
          createdAt: new Date()
        });
      }

      // 4. Process content and handle images
      let finalContent = textContent;
      const imageUrls = new Set();
      const failedImages = new Set();

      // Extract all image URLs from content
      const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
      let match;
      while ((match = imgRegex.exec(finalContent)) !== null) {
        imageUrls.add(match[1]);
      }

      // Process each image
      for (const imageUrl of imageUrls) {
        try {
          if (imageUrl.includes('/temp/')) {  // Only process temporary images
            // 4a. Extract filename and generate new path
            const filename = imageUrl.split('/').pop().split('?')[0];
            const permanentPath = `submissions/${currentActivity.id}/${studentId}/${filename}`;

            // 4b. Fetch image from temporary URL
            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
            const blob = await response.blob();

            // 4c. Upload to permanent location
            const permanentRef = ref(storage, permanentPath);
            const metadata = {
              contentType: blob.type,
              customMetadata: {
                originalUrl: imageUrl,
                submissionId: `${currentActivity.id}_${studentId}`,
                uploadedAt: new Date().toISOString()
              }
            };

            await uploadBytes(permanentRef, blob, metadata);
            const permanentUrl = await getDownloadURL(permanentRef);

            // 4d. Replace URL in content
            finalContent = finalContent.replace(
              new RegExp(imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
              permanentUrl
            );

            // 4e. Clean up temporary file
            try {
              const tempRef = ref(storage, imageUrl.split('.com/o/')[1].split('?')[0]);
              await deleteObject(tempRef);
            } catch (cleanupError) {
              console.warn('Failed to cleanup temp file:', cleanupError);
              // Continue despite cleanup failure
            }
          }
        } catch (imageError) {
          console.error('Failed to process image:', imageError);
          failedImages.add(imageUrl);
        }
      }

      // 5. Check for failed images
      if (failedImages.size > 0) {
        throw new Error(`Failed to process ${failedImages.size} images. Please try again.`);
      }

      // 6. Prepare submission content
      const submissionContent = {
        content: finalContent,
        type: 'rich-content',
        version: '1.0',
        metadata: {
          hasImages: imageUrls.size > 0,
          imageCount: imageUrls.size,
          textLength: finalContent.replace(/<[^>]+>/g, '').trim().length,
          lastModified: new Date().toISOString()
        }
      };

      // 7. Create submission document
      const submissionDoc = await addDoc(collection(db, 'submissions'), {
        activityId: currentActivity.id,
        studentName,
        studentEmail,
        studentId,
        content: submissionContent.content,
        metadata: submissionContent.metadata,
        timestamp: new Date(),
        status: 'submitted',
        version: '1.0'
      });

      console.log('Submission successful:', submissionDoc.id);

      // 8. Update local state
      setStudentId(studentId);
      setSubmitted(true);
      setTextContent('');
      setTempImageUrls([]);

      // Optional: Add submission to activity's submissions array
      try {
        const activityRef = doc(db, 'activities', currentActivity.id);
        await updateDoc(activityRef, {
          submissions: arrayUnion(submissionDoc.id)
        });
      } catch (activityUpdateError) {
        console.warn('Failed to update activity with submission ID:', activityUpdateError);
        // Continue despite failure as this is not critical
      }

    } catch (error) {
      console.error('Error in submission process:', error);
      alert(
        error.message || 'Error submitting your work. Please check the console for more details and try again.'
      );
      throw error; // Re-throw to allow caller to handle if needed
    }
  };


  const handleReset = () => {
    setPhase('wait');
    setCurrentActivity(null);
    setStudentName('');
    setStudentEmail('');
    setSubmission('');
    setEvaluationPair(null);
    setLeftComments('');
    setRightComments('');
    setSubmitted(false);
    setEvaluationSubmitted(false);
    setReceivedEvaluations([]);
    setStudentId(null);
    localStorage.clear();
  };

  // Get pair for evaluation (updated for new algorithm)
  // Update the evaluation pair fetching useEffect in Student.jsx
  // In Student.jsx, update the getEvaluationPair function:

  useEffect(() => {
    const getEvaluationPair = async () => {
      if (!currentActivity || phase !== 'evaluate' || !studentEmail) {
        console.log('Missing required data:', {
          hasActivity: !!currentActivity,
          phase,
          hasEmail: !!studentEmail,
        });
        return;
      }

      const currentRound = currentActivity.currentRound;
      console.log('Getting evaluation pair for round:', currentRound);

      try {
        // First check if student has already evaluated in this round
        const evaluationsSnapshot = await getDocs(
          query(
            collection(db, 'evaluations'),
            where('activityId', '==', currentActivity.id),
            where('evaluatorEmail', '==', studentEmail),
            where('round', '==', currentRound)
          )
        );

        console.log(`Found ${evaluationsSnapshot.docs.length} evaluations by this student for round ${currentRound}`);

        if (!evaluationsSnapshot.empty) {
          console.log('Student has already evaluated in this round');
          setEvaluationSubmitted(true);
          return;
        }

        // Get assigned pair from activity document
        const activityDoc = await getDoc(doc(db, 'activities', currentActivity.id));
        const assignments = activityDoc.data()?.evaluatorAssignments || {};
        const assignedEmails = assignments[studentEmail];

        if (!assignedEmails) {
          console.log('No evaluation pair assigned to this student');
          return;
        }

        console.log('Found assigned emails:', assignedEmails);

        // Fetch the submissions for the assigned emails
        const submissionsSnapshot = await getDocs(
          query(
            collection(db, 'submissions'),
            where('activityId', '==', currentActivity.id),
            where('studentEmail', 'in', assignedEmails)
          )
        );

        if (submissionsSnapshot.empty) {
          console.error('No submissions found for assigned emails');
          return;
        }

        const submissions = submissionsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setEvaluationPair({
          left: submissions[0],
          right: submissions[1]
        });

      } catch (error) {
        console.error('Error getting evaluation pair:', error);
      }
    };

    getEvaluationPair();
  }, [currentActivity?.currentRound, phase, studentEmail, evaluationSubmitted]);


  // Submit evaluation
  const submitEvaluation = async (winner) => {
    if (!currentActivity || !evaluationPair) return;

    await addDoc(collection(db, 'evaluations'), {
      activityId: currentActivity.id,
      round: currentActivity.currentRound,
      evaluatorEmail: studentEmail,
      leftSubmissionId: evaluationPair.left.id,
      rightSubmissionId: evaluationPair.right.id,
      winner:
        winner === 'left' ? evaluationPair.left.id : evaluationPair.right.id,
      leftComments,
      rightComments,
      timestamp: new Date(),
    });

    setEvaluationSubmitted(true);
    setEvaluationPair(null);
    setLeftComments('');
    setRightComments('');
  };

  // Get received evaluations
  // Get received evaluations
  useEffect(() => {
    if (!currentActivity || phase !== 'final' || !studentEmail || !studentId) {
      setReceivedEvaluations([]); // Clear evaluations if conditions not met
      return;
    }

    const fetchEvaluations = async () => {
      try {
        // First get this student's submission with strict validation
        const submissionSnapshot = await getDocs(
          query(
            collection(db, 'submissions'),
            where('activityId', '==', currentActivity.id),
            where('studentEmail', '==', studentEmail),
            where('studentId', '==', studentId)
          )
        );

        if (submissionSnapshot.empty) {
          console.log('No matching submission found for current credentials');
          setReceivedEvaluations([]);
          return;
        }

        const submissionId = submissionSnapshot.docs[0].id;

        // Get evaluations where this submission was evaluated (either left or right)
        const leftEvaluationsSnapshot = await getDocs(
          query(
            collection(db, 'evaluations'),
            where('activityId', '==', currentActivity.id),
            where('leftSubmissionId', '==', submissionId)
          )
        );

        const rightEvaluationsSnapshot = await getDocs(
          query(
            collection(db, 'evaluations'),
            where('activityId', '==', currentActivity.id),
            where('rightSubmissionId', '==', submissionId)
          )
        );

        // Combine and process all evaluations
        const allEvaluations = [
          ...leftEvaluationsSnapshot.docs,
          ...rightEvaluationsSnapshot.docs
        ];

        // Process evaluations to get the correct comments
        const processedEvaluations = allEvaluations.map(doc => {
          const data = doc.data();
          // Determine if this submission won
          const won = data.winner === submissionId;
          // Get the appropriate comments based on whether this was left or right submission
          const isLeft = data.leftSubmissionId === submissionId;
          const comments = isLeft ? data.leftComments : data.rightComments;

          return {
            evaluatorEmail: data.evaluatorEmail,
            evaluationId: doc.id,
            comments,
            timestamp: data.timestamp,
            round: data.round,
            won,
            reactions: data.reactions || { thumbsUp: [], thumbsDown: [] } // Add this line
          };
        });


        // Remove any duplicate evaluations (in case a submission appears in both queries)
        const uniqueEvaluations = _.uniqBy(processedEvaluations,
          evaluation => `${evaluation.evaluatorEmail}-${evaluation.round}`
        );

        setReceivedEvaluations(uniqueEvaluations);
      } catch (error) {
        console.error('Error fetching evaluations:', error);
        setReceivedEvaluations([]);
      }
    };

    fetchEvaluations();
  }, [currentActivity, phase, studentEmail, studentId]); // Include all dependencies



  // Render logic
  if (phase === 'wait' || !currentActivity) {
    return (
      <div className="p-8">
        <h1 className="text-2xl">Waiting for activity to start...</h1>
      </div>
    );
  }

  if (phase === 'submit') {
    if (submitted) {
      return (
        <div className="p-8">
          <div className="bg-gray-100 p-4 mb-6 rounded-lg">
            <h2 className="text-lg font-semibold">
              {currentActivity?.name || 'Activity'}
              {studentName && ` - ${studentName}`}
            </h2>
            <p className="text-gray-600 text-sm">{studentEmail}</p>
          </div>
          <h1 className="text-2xl">Your submission has been received</h1>
          <p>Please wait for the evaluation phase to begin.</p>
        </div>
      );
    }

    return (
      <div className="p-8">
        <div className="bg-gray-100 p-4 mb-6 rounded-lg">
          <h2 className="text-lg font-semibold">
            {currentActivity?.name || 'Activity'}
            {studentName && ` - ${studentName}`}
          </h2>
          <p className="text-gray-600 text-sm">{studentEmail}</p>
        </div>
        <h1 className="text-2xl mb-4">Submit Your Work</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="Your Name"
              className="border p-2 w-full"
              required
            />
          </div>
          <div>
            <input
              type="email"
              value={studentEmail}
              onChange={(e) => setStudentEmail(e.target.value)}
              placeholder="Your Email"
              className="border p-2 w-full"
              required
            />
          </div>
          <div>
            <div className="space-y-4">
              <div className="relative">
                <div
                  ref={(element) => {
                    if (element && !element.innerHTML && textContent) {
                      element.innerHTML = textContent;
                    }
                  }}
                  className="border p-2 w-full min-h-32 bg-white"
                  contentEditable
                  suppressContentEditableWarning={true}
                  onPaste={handlePaste}
                  onInput={(e) => {
                    const newContent = e.currentTarget.innerHTML;
                    if (newContent !== textContent) {
                      setTextContent(newContent);
                    }
                  }}
                />
                {!textContent && (
                  <div className="absolute top-2 left-2 text-gray-400 pointer-events-none">
                    Paste or type your submission here
                  </div>
                )}
              </div>

              {/* Image preview (using temporary URLs) */}
              {tempImageUrls.length > 0 && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  {tempImageUrls.map((imageUrl, index) => (
                    <div key={index} className="relative">
                      <img
                        src={imageUrl}
                        alt={`Upload preview ${index + 1}`}
                        className="max-w-full h-auto"
                      />
                      <button
                        onClick={() => {
                          setTempImageUrls(prev => prev.filter((_, i) => i !== index));
                          setTextContent(prevContent =>
                            prevContent.replace(`<img src="${imageUrl}" alt="Pasted Image" />`, '')
                          );
                        }}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            type="submit"
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition-colors"
          >
            Submit
          </button>
        </form>
      </div>
    );
  }


  if (phase === 'evaluate') {
    if (!studentEmail || !studentId) {
      return (
        <div className="p-8">
          <h1 className="text-2xl text-red-600">Session expired</h1>
          <p>Please refresh the page to start over.</p>
        </div>
      );
    }

    if (evaluationSubmitted) {
      return (
        <div className="p-8">
          <h1 className="text-2xl">Your evaluation for this round has been submitted.</h1>
          <p>Please wait for the next round or final results.</p>
          <p className="mt-4 text-gray-600">Logged in as: {studentName} ({studentEmail})</p>
        </div>
      );
    }

    // In Student.jsx, find the evaluation phase section that looks like this:
    if (evaluationPair) {
      return (
        <div className="p-8">
          <h1 className="text-2xl mb-4">Evaluate Submissions</h1>
          <div className="grid grid-cols-2 gap-8">
            {/* Left Submission */}
            <div className="border p-4">
              <div className="mb-2 text-sm font-medium text-gray-500">
                Submission by: {currentActivity?.hideNames ? "Anonymous Submission" : evaluationPair.left.studentName}
              </div>
              <div className="h-48 overflow-y-auto mb-4">
                <div dangerouslySetInnerHTML={{ __html: evaluationPair.left.content }} />
              </div>
              <textarea
                value={leftComments}
                onChange={(e) => setLeftComments(e.target.value)}
                placeholder="Comments for left submission"
                className="border p-2 w-full h-32 mb-4"
              />
              <button
                onClick={() => submitEvaluation('left')}
                className="bg-blue-500 text-white px-4 py-2 rounded w-full"
              >
                Left is Better
              </button>
            </div>

            {/* Right Submission */}
            <div className="border p-4">
              <div className="mb-2 text-sm font-medium text-gray-500">
                Submission by: {currentActivity?.hideNames ? "Anonymous Submission" : evaluationPair.right.studentName}
              </div>
              <div className="h-48 overflow-y-auto mb-4">
                <div dangerouslySetInnerHTML={{ __html: evaluationPair.right.content }} />
              </div>
              <textarea
                value={rightComments}
                onChange={(e) => setRightComments(e.target.value)}
                placeholder="Comments for right submission"
                className="border p-2 w-full h-32 mb-4"
              />
              <button
                onClick={() => submitEvaluation('right')}
                className="bg-blue-500 text-white px-4 py-2 rounded w-full"
              >
                Right is Better
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="p-8">
        <h1 className="text-2xl">Waiting for evaluation pair...</h1>
      </div>
    );
  }

  if (phase === 'final') {
    if (!studentEmail || !studentId) {
      return (
        <div className="p-8">
          <h1 className="text-2xl text-red-600">Session expired</h1>
          <p>Please refresh the page and start over.</p>
          <button
            onClick={handleReset}
            className="mt-4 bg-blue-500 text-white px-4 py-2 rounded"
          >
            Reset Session
          </button>
        </div>
      );
    }

    return (
      <div className="p-8">
        <div className="bg-gray-100 p-4 mb-6 rounded-lg">
          <h2 className="text-lg font-semibold">
            {currentActivity?.name || 'Activity'}
            {studentName && ` - ${studentName}`}
          </h2>
          <p className="text-gray-600 text-sm">{studentEmail}</p>
        </div>
        <h1 className="text-2xl mb-4">Evaluation Summary</h1>
        <p className="mb-6">
          Your submission received {receivedEvaluations.length} evaluations.
        </p>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Comments received:</h2>
          {receivedEvaluations.length > 0 ? (
            <div className="space-y-4">
              {receivedEvaluations.map((evaluation, index) => (
                <div key={index} className="bg-white shadow rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-2">
                    Round {evaluation.round}
                  </div>
                  <p className="text-gray-700">
                    {evaluation.comments || "No comments provided"}
                  </p>
                  <div className="mt-2">
                    <button
                      onClick={() => handleStarToggle(
                        evaluation.evaluationId,
                        evaluation.stars || []
                      )}
                      className={`p-2 rounded hover:bg-gray-100 ${(evaluation.stars || []).includes(studentEmail)
                          ? 'text-yellow-500'
                          : 'text-gray-400'
                        }`}
                    >
                      ★
                    </button>
                  </div>
                </div>
              ))}

            </div>
          ) : (
            <p className="text-gray-500">No evaluations received yet.</p>
          )}
        </div>


      </div>
    );
  }

  return null;
}

export default Student;
