//Student.jsx
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc, 
  doc,    
  onSnapshot,
  limit,
  orderBy,
  arrayUnion,
  updateDoc,
  runTransaction 
} from 'firebase/firestore';
import _ from 'lodash';
import {
  getStorage, ref, uploadBytes, getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { runEvaluationRound } from './evaluationManager';


function Student() {
  const [phase, setPhase] = useState('wait');
  const [currentActivity, setCurrentActivity] = useState(null);
  const [studentName, setStudentName] = useState(() => localStorage.getItem('studentName') || '');
  const [studentEmail, setStudentEmail] = useState(() => localStorage.getItem('studentEmail') || '');
  const [submission, setSubmission] = useState('');
  const [evaluationPair, setEvaluationPair] = useState(null);
  const [leftComments, setLeftComments] = useState('');
  const [rightComments, setRightComments] = useState('');
  const [submitted, setSubmitted] = useState(() => 
  localStorage.getItem('submitted') === 'true'
);
const [evaluationSubmitted, setEvaluationSubmitted] = useState(() => 
  localStorage.getItem('evaluationSubmitted') === 'true'
);
  const [receivedEvaluations, setReceivedEvaluations] = useState([]);
  const [textContent, setTextContent] = useState('');
  const [feedbackGiven, setFeedbackGiven] = useState([]);
  const [images, setImages] = useState([]);
  
  const storage = getStorage();
  const [studentId, setStudentId] = useState(() =>
    localStorage.getItem('studentId') ? Number(localStorage.getItem('studentId')) : null
  );



  useEffect(() => {
    if ((!studentEmail || !studentId) && localStorage.getItem('studentEmail')) {
      recoverSession();
    }
  }, [studentEmail, studentId]); 
  
// Add this effect to warn users before closing/refreshing
useEffect(() => {
  // Define handler outside to avoid reference issues
  const handleBeforeUnload = (e) => {
    if (phase === 'evaluate' && !evaluationSubmitted) {
      e.preventDefault();
      e.returnValue = 'You have unsaved evaluation progress. Are you sure you want to leave?';
      return e.returnValue;
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [phase, evaluationSubmitted]); // Remove handleBeforeUnload from deps


  // Persistence effect
  useEffect(() => {
    if (studentName) localStorage.setItem('studentName', studentName);
    if (studentEmail) localStorage.setItem('studentEmail', studentEmail);
    if (studentId) localStorage.setItem('studentId', studentId.toString());
  }, [studentName, studentEmail, studentId]);

  useEffect(() => {
    localStorage.setItem('submitted', submitted);
    localStorage.setItem('evaluationSubmitted', evaluationSubmitted);
  }, [submitted, evaluationSubmitted]);


  useEffect(() => {
    const q = query(
      collection(db, 'activities'),
      where('isActive', '==', true)
    );
  
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        console.log('No active activity found');
        setPhase('wait');
        setCurrentActivity(null);
        // Don't clear everything - preserve session info
        setSubmission('');
        setEvaluationPair(null);
        setLeftComments('');
        setRightComments('');
        // Don't reset submitted states here
        return;
      }
  
      const activity = {
        id: snapshot.docs[0].id,
        ...snapshot.docs[0].data(),
      };
      console.log('Active activity updated:', activity);
  
      setCurrentActivity(activity);
      setPhase(activity.phase);
  
      // Only reset evaluation state if round changes
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


  
  


  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!currentActivity || submitted) return;
  
    try {
      // 1. Basic validation
      if (!studentName.trim() || !studentEmail.trim() || !textContent.trim()) {
        throw new Error('Please fill in all required fields');
      }
  
      await runTransaction(db, async (transaction) => {
        // 2. Check for existing submissions
        const existingSubmissionsRef = query(
          collection(db, 'submissions'),
          where('activityId', '==', currentActivity.id),
          where('studentEmail', '==', studentEmail)
        );
        const existingSubmissions = await getDocs(existingSubmissionsRef);
  
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
          const allStudentsQuery = query(
            collection(db, 'students'),
            orderBy('studentId', 'desc'),
            limit(1)
          );
          const allStudentsSnapshot = await getDocs(allStudentsQuery);
          studentId = (allStudentsSnapshot.empty ? 0 : allStudentsSnapshot.docs[0].data().studentId) + 1;
  
          const newStudentRef = doc(collection(db, 'students'));
          transaction.set(newStudentRef, {
            email: studentEmail,
            name: studentName,
            studentId: studentId,
            createdAt: new Date()
          });
        }
  
        // 4. Process images - move from temp to permanent storage
        const permanentImages = [];
        for (const imageUrl of images) {
          if (imageUrl.includes('/temp/')) {
            const filename = imageUrl.split('/').pop().split('?')[0];
            const permanentPath = `submissions/${currentActivity.id}/${studentId}/${filename}`;
            
            // Fetch image from temporary URL
            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
            const blob = await response.blob();
            
            // Upload to permanent location
            const permanentRef = ref(storage, permanentPath);
            const metadata = {
              contentType: blob.type,
              customMetadata: {
                originalUrl: imageUrl,
                submissionId: `${currentActivity.id}_${studentId}`,
                uploadedAt: new Date().toISOString()
              }
            };
  
            const uploadResult = await uploadBytes(permanentRef, blob, metadata);
            const permanentUrl = await getDownloadURL(uploadResult.ref);
            permanentImages.push(permanentUrl);
  
            // Clean up temporary file
            try {
              const tempRef = ref(storage, imageUrl.split('.com/o/')[1].split('?')[0]);
              await deleteObject(tempRef);
            } catch (cleanupError) {
              console.warn('Failed to cleanup temp file:', cleanupError);
            }
          } else {
            permanentImages.push(imageUrl); // Keep already permanent URLs
          }
        }
  
        // 5. Create submission document
        const submissionRef = doc(collection(db, 'submissions'));
        transaction.set(submissionRef, {
          activityId: currentActivity.id,
          studentName,
          studentEmail,
          studentId,
          content: textContent,
          images: permanentImages, // Now using permanent image URLs
          timestamp: new Date(),
          status: 'submitted',
          version: '1.0'
        });
  
        // 6. Update activity's submissions array
        const activityRef = doc(db, 'activities', currentActivity.id);
        transaction.update(activityRef, {
          submissions: arrayUnion(submissionRef.id)
        });
  
        // 7. Update local state after successful transaction
        setStudentId(studentId);
        setSubmitted(true);
        setImages(permanentImages);
      });
  
    } catch (error) {
      console.error('Error in submission process:', error);
      alert(error.message || 'Error submitting your work. Please try again.');
      throw error;
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

  const recoverSession = async () => {
    if (!studentEmail || !studentId) return false;
    
    try {
      // Verify student exists
      const studentQuery = query(
        collection(db, 'students'),
        where('email', '==', studentEmail),
        where('studentId', '==', studentId)
      );
      const studentSnapshot = await getDocs(studentQuery);
      
      if (studentSnapshot.empty) {
        console.log('No matching student found');
        return false;
      }
  
      // Check for submission in current activity
      if (currentActivity) {
        const submissionQuery = query(
          collection(db, 'submissions'),
          where('activityId', '==', currentActivity.id),
          where('studentEmail', '==', studentEmail)
        );
        const submissionSnapshot = await getDocs(submissionQuery);
        
        if (!submissionSnapshot.empty) {
          setSubmitted(true);
        }
  
        // Check for evaluation in current round
        if (phase === 'evaluate') {
          const evaluationQuery = query(
            collection(db, 'evaluations'),
            where('activityId', '==', currentActivity.id),
            where('evaluatorEmail', '==', studentEmail),
            where('round', '==', currentActivity.currentRound)
          );
          const evaluationSnapshot = await getDocs(evaluationQuery);
          
          if (!evaluationSnapshot.empty) {
            setEvaluationSubmitted(true);
          }
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error recovering session:', error);
      return false;
    }
  };
  

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
  
    if (images.length >= 3) {
      alert('Maximum 3 images allowed');
      return;
    }
  
    if (file.size > 1024 * 1024) {
      alert('Image must be smaller than 1MB');
      return;
    }
  
    try {
      const reader = new FileReader();
      
      reader.onerror = () => {
        console.error('FileReader error:', reader.error);
        alert('Failed to read image file. Please try again.');
      };
  
      reader.onloadend = () => {
        if (reader.error) return; // Error already handled
        const base64String = reader.result;
        setImages(prev => [...prev, base64String]);
      };
  
      reader.readAsDataURL(file);
      e.target.value = ''; // Reset file input
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image. Please try again.');
    }
  };
  

// Replace the removeImage function
const removeImage = (index) => {
  setImages(prev => prev.filter((_, i) => i !== index));
};

  // Render logic
  if (phase === 'wait' || !currentActivity) {
    return (
      <div className="p-8">
        <h1 className="text-2xl">Waiting for activity to start...</h1>
      </div>
    );
  }

  // In Student.jsx, replace the submit phase return statement with this:

if (phase === 'submit') {
  if (submitted) {
    return (
      <div className="p-8">
        <div className="bg-gray-100 p-4 mb-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">
            {currentActivity?.name || 'Activity'} - Submission Received
          </h2>
          <p className="text-gray-700 mb-2">Submitted by: {studentName}</p>
          <p className="text-gray-600 text-sm">{studentEmail}</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg border mb-4">
          <h3 className="font-medium mb-2">Your Submission:</h3>
          <div className="whitespace-pre-wrap mb-4">{textContent}</div>
          {images.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Attached Images:</h4>
              <div className="grid grid-cols-2 gap-4">
                {images.map((img, index) => (
                  <img 
                    key={index}
                    src={img}
                    alt={`Submission image ${index + 1}`}
                    className="max-w-full h-auto rounded"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleReset}
          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
        >
          Remove Submission and Start Over
        </button>
        
        <p className="mt-4 text-gray-600">Please wait for the evaluation phase to begin.</p>
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
            className="border p-2 w-full rounded"
            required
          />
        </div>
        
        <div>
          <input
            type="email"
            value={studentEmail}
            onChange={(e) => setStudentEmail(e.target.value)}
            placeholder="Your Email"
            className="border p-2 w-full rounded"
            required
          />
        </div>

        <div>
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Type your submission here"
            className="border p-2 w-full h-48 rounded font-mono"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Images (Maximum 3)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
            disabled={images.length >= 3}
          />
          {images.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              {images.map((img, index) => (
                <div key={index} className="relative">
                  <img
                    src={img}
                    alt={`Upload ${index + 1}`}
                    className="max-w-full h-auto rounded"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {images.length >= 3 && (
            <p className="text-sm text-red-500 mt-1">
              Maximum number of images (3) reached
            </p>
          )}
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

const ExpiredSessionView = () => {
  const [isRecovering, setIsRecovering] = useState(false);

  const handleRecoverSession = async () => {
    setIsRecovering(true);
    try {
      const recovered = await recoverSession();
      if (!recovered) {
        alert('Failed to recover session. Please start over.');
      }
    } catch (error) {
      console.error('Error recovering session:', error);
      alert('Error recovering session. Please try again.');
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl text-red-600">Session expired</h1>
      <p>Click below to try recovering your session, or refresh the page to start over.</p>
      <div className="mt-4 space-x-4">
        <button
          onClick={handleRecoverSession}
          disabled={isRecovering}
          className={`${
            isRecovering ? 'bg-blue-300' : 'bg-blue-500 hover:bg-blue-600'
          } text-white px-4 py-2 rounded transition-colors`}
        >
          {isRecovering ? 'Recovering...' : 'Recover Session'}
        </button>
        <button
          onClick={handleReset}
          disabled={isRecovering}
          className={`${
            isRecovering ? 'bg-gray-300' : 'bg-gray-500 hover:bg-gray-600'
          } text-white px-4 py-2 rounded transition-colors`}
        >
          Start Over
        </button>
      </div>
    </div>
  );
};


  if (phase === 'evaluate') {
    if (!studentEmail || !studentId) {
      return <ExpiredSessionView />;
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
              <div className="h-48 overflow-y-auto mb-4 whitespace-pre-wrap">
  {evaluationPair.left.content}
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
              <div className="h-48 overflow-y-auto mb-4 whitespace-pre-wrap">
  {evaluationPair.right.content}
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
      return <ExpiredSessionView />;
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
