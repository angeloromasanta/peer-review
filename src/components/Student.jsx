//Student.jsx
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  limit,
  orderBy,
} from 'firebase/firestore';

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
  const [studentId, setStudentId] = useState(() => 
    localStorage.getItem('studentId') ? Number(localStorage.getItem('studentId')) : null
  );

  // Persistence effect
  useEffect(() => {
    if (studentName) localStorage.setItem('studentName', studentName);
    if (studentEmail) localStorage.setItem('studentEmail', studentEmail);
    if (studentId) localStorage.setItem('studentId', studentId.toString());
  }, [studentName, studentEmail, studentId]);


  // Listen to current activity
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'activities'),
        orderBy('currentRound', 'desc'),
        limit(1)
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          const activity = {
            id: snapshot.docs[0].id,
            ...snapshot.docs[0].data(),
          };
          console.log('Activity updated:', activity);
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
        }
      }
    );
  
    return () => unsubscribe();
  }, [currentActivity?.currentRound]);

  // Handle submission
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!currentActivity) return;
  
    try {
      console.log('Handling submission with:', { studentName, studentEmail });
      
      // Get or create student ID
      const id = await getAssignedStudentId(studentEmail);
      setStudentId(id);
      
      await addDoc(collection(db, 'submissions'), {
        activityId: currentActivity.id,
        studentName,
        studentEmail,
        studentId: id,
        content: submission,
        timestamp: new Date(),
      });
  
      setSubmitted(true);
    } catch (error) {
      console.error('Error submitting:', error);
    }
  };

  // Function to get assigned student ID
  const getAssignedStudentId = async (email) => {
    console.log('Getting assigned student ID for:', email);
    
    try {
      const studentQuery = query(
        collection(db, 'students'),
        where('email', '==', email)
      );
      const studentSnapshot = await getDocs(studentQuery);
  
      if (!studentSnapshot.empty) {
        // Student exists, return existing ID
        const existingStudentData = studentSnapshot.docs[0].data();
        console.log('Found existing student ID:', existingStudentData.studentId);
        setStudentId(existingStudentData.studentId);
        return existingStudentData.studentId;
      } else {
        // Assign a new student ID
        const allStudentsQuery = query(
          collection(db, 'students'),
          orderBy('studentId', 'desc'),
          limit(1)
        );
        const allStudentsSnapshot = await getDocs(allStudentsQuery);
        const lastStudentId = allStudentsSnapshot.empty
          ? 0
          : allStudentsSnapshot.docs[0].data().studentId;
        const newStudentId = lastStudentId + 1;
  
        console.log('Creating new student ID:', newStudentId);
  
        // Add the new student to the collection
        await addDoc(collection(db, 'students'), {
          email: email,
          studentId: newStudentId,
        });
  
        setStudentId(newStudentId);
        return newStudentId;
      }
    } catch (error) {
      console.error('Error getting assigned student ID:', error);
      throw error;
    }
  };

  // Use effect to set student ID
  useEffect(() => {
    const setStudentIdAsync = async () => {
      if (studentEmail) {
        const id = await getAssignedStudentId(studentEmail);
        setStudentId(id);
      }
    };

    setStudentIdAsync();
  }, [studentEmail]);

  // Get pair for evaluation (updated for new algorithm)
  useEffect(() => {
    const getEvaluationPair = async () => {
      if (!currentActivity || phase !== 'evaluate' || !studentEmail || !studentId) {
        console.log('Missing required data:', {
          hasActivity: !!currentActivity,
          phase,
          hasEmail: !!studentEmail,
          hasId: !!studentId
        });
        return;
      }
  
      const currentRound = currentActivity.currentRound;
      console.log('Getting evaluation pair for round:', currentRound);
  
      try {
        // Fetch evaluations for the current round only
        const evaluationsSnapshot = await getDocs(
          query(
            collection(db, 'evaluations'),
            where('activityId', '==', currentActivity.id),
            where('evaluatorEmail', '==', studentEmail),
            where('round', '==', currentRound) // Add round filter
          )
        );
  
        console.log(`Found ${evaluationsSnapshot.docs.length} evaluations by this student for round ${currentRound}`);
  
        // Reset evaluation submitted state if student hasn't evaluated in this round
        if (evaluationsSnapshot.empty) {
          console.log('No evaluations found for current round, resetting evaluation state');
          setEvaluationSubmitted(false);
        }
  
        if (evaluationSubmitted) {
          console.log('Student has already submitted evaluation for this round');
          return;
        }
  
        const evaluatedSubmissions = new Set();
        evaluationsSnapshot.forEach((doc) => {
          const data = doc.data();
          evaluatedSubmissions.add(data.leftSubmissionId);
          evaluatedSubmissions.add(data.rightSubmissionId);
        });
  
        // Fetch all submissions for the activity
        const submissionsSnapshot = await getDocs(
          query(
            collection(db, 'submissions'),
            where('activityId', '==', currentActivity.id)
          )
        );
  
        const submissions = submissionsSnapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((submission) => submission.studentEmail !== studentEmail);
  
        console.log(`Found ${submissions.length} total submissions (excluding own)`);
  
        if (submissions.length < 2) {
          console.log('Not enough submissions to create a pair');
          return;
        }
  
        // Sort submissions based on the round
        if (currentRound === 1) {
          submissions.sort((a, b) => a.studentId - b.studentId);
          console.log('Round 1: Sorted by student ID');
        } else {
          // Get all evaluations for ranking
          const allEvaluations = await getDocs(
            query(
              collection(db, 'evaluations'),
              where('activityId', '==', currentActivity.id)
            )
          );
  
          const scores = {};
          allEvaluations.forEach((doc) => {
            const evaluation = doc.data();
            scores[evaluation.winner] = (scores[evaluation.winner] || 0) + 1;
          });
  
          submissions.sort((a, b) => {
            const scoreA = scores[a.id] || 0;
            const scoreB = scores[b.id] || 0;
            if (scoreA !== scoreB) return scoreB - scoreA;
            return Math.random() - 0.5;
          });
          console.log('Later round: Sorted by scores and randomized ties');
        }
  
        // Find a suitable pair that hasn't been evaluated
        let pairFound = false;
        for (let i = 0; i < submissions.length - 1 && !pairFound; i++) {
          for (let j = i + 1; j < submissions.length && !pairFound; j++) {
            if (!evaluatedSubmissions.has(submissions[i].id) && 
                !evaluatedSubmissions.has(submissions[j].id)) {
              console.log('Found new pair for evaluation');
              setEvaluationPair({
                left: submissions[i],
                right: submissions[j]
              });
              pairFound = true;
            }
          }
        }
  
        if (!pairFound) {
          console.log('No suitable pairs found for evaluation');
        }
  
      } catch (error) {
        console.error('Error getting evaluation pair:', error);
      }
    };
  
    getEvaluationPair();
  }, [currentActivity?.currentRound, phase, studentEmail, studentId, evaluationSubmitted]);
  


  
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
    if (!currentActivity || phase !== 'final' || !studentEmail) return;

    const fetchEvaluations = async () => {
      const submissionSnapshot = await getDocs(
        query(
          collection(db, 'submissions'),
          where('activityId', '==', currentActivity.id),
          where('studentEmail', '==', studentEmail)
        )
      );

      if (submissionSnapshot.empty) return;

      const submissionId = submissionSnapshot.docs[0].id;

      const evaluationsSnapshot = await getDocs(
        query(
          collection(db, 'evaluations'),
          where('activityId', '==', currentActivity.id),
          where('winner', '==', submissionId)
        )
      );

      setReceivedEvaluations(evaluationsSnapshot.docs.map((doc) => doc.data()));
    };

    fetchEvaluations();
  }, [currentActivity, phase, studentEmail]);

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
          <h1 className="text-2xl">Your submission has been received</h1>
          <p>Please wait for the evaluation phase to begin.</p>
        </div>
      );
    }

    return (
      <div className="p-8">
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
            <textarea
              value={submission}
              onChange={(e) => setSubmission(e.target.value)}
              placeholder="Your Submission"
              className="border p-2 w-full h-32"
              required
            />
          </div>
          <button
            type="submit"
            className="bg-blue-500 text-white px-4 py-2 rounded"
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

    if (evaluationPair) {
      return (
        <div className="p-8">
          <h1 className="text-2xl mb-4">Evaluate Submissions</h1>
          <div className="grid grid-cols-2 gap-8">
            {/* Left Submission */}
            <div className="border p-4">
              <div className="h-48 overflow-y-auto mb-4">
                <p>{evaluationPair.left.content}</p>
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
              <div className="h-48 overflow-y-auto mb-4">
                <p>{evaluationPair.right.content}</p>
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
    return (
      <div className="p-8">
        <h1 className="text-2xl mb-4">Evaluation Summary</h1>
        <p>
          Your submission received {receivedEvaluations.length} positive
          evaluations.
        </p>
        <div className="mt-4">
          <h2 className="text-xl mb-2">Comments received:</h2>
          {receivedEvaluations.map((evaluation, index) => (
            <div key={index} className="border p-4 mb-2">
              <p>{evaluation.comments}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export default Student;
