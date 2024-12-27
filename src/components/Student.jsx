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
  const [phase, setPhase] = useState('wait');
  const [currentActivity, setCurrentActivity] = useState(null);
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [submission, setSubmission] = useState('');
  const [evaluationPair, setEvaluationPair] = useState(null);
  const [leftComments, setLeftComments] = useState('');
  const [rightComments, setRightComments] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [evaluationSubmitted, setEvaluationSubmitted] = useState(false);
  const [receivedEvaluations, setReceivedEvaluations] = useState([]);
  const [studentId, setStudentId] = useState(null);

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
          setCurrentActivity(activity);
          setPhase(activity.phase);
          setEvaluationSubmitted(false);
        }
      }
    );

    return () => unsubscribe();
  }, []);

  // Handle submission
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!currentActivity) return;

    await addDoc(collection(db, 'submissions'), {
      activityId: currentActivity.id,
      studentName,
      studentEmail,
      studentId: studentId,
      content: submission,
      timestamp: new Date(),
    });

    setSubmitted(true);
  };

  // Function to get assigned student ID
  const getAssignedStudentId = async (email) => {
    const studentQuery = query(
      collection(db, 'students'),
      where('email', '==', email)
    );
    const studentSnapshot = await getDocs(studentQuery);

    if (!studentSnapshot.empty) {
      // Student exists, return existing ID
      const existingStudentData = studentSnapshot.docs[0].data();
      return existingStudentData.studentId;
    } else {
      // Assign a new student ID
      const allStudentsQuery = query(
        collection(db, 'students'),
        orderBy('studentId', 'desc')
      );
      const allStudentsSnapshot = await getDocs(allStudentsQuery);
      const lastStudentId = allStudentsSnapshot.empty
        ? 0
        : allStudentsSnapshot.docs[0].data().studentId;
      const newStudentId = lastStudentId + 1;

      // Add the new student to the collection
      await addDoc(collection(db, 'students'), {
        email: email,
        studentId: newStudentId,
      });

      return newStudentId;
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
      if (
        !currentActivity ||
        phase !== 'evaluate' ||
        !studentEmail ||
        !studentId
      )
        return;

      const currentRound = currentActivity.currentRound;

      // Fetch evaluations to check for previous evaluations by this student
      const evaluationsSnapshot = await getDocs(
        query(
          collection(db, 'evaluations'),
          where('activityId', '==', currentActivity.id),
          where('evaluatorEmail', '==', studentEmail)
        )
      );

      const evaluatedSubmissions = new Set();
      evaluationsSnapshot.forEach((doc) => {
        const data = doc.data();
        evaluatedSubmissions.add(data.leftSubmissionId);
        evaluatedSubmissions.add(data.rightSubmissionId);
      });

      // Fetch submissions and sort based on the algorithm
      const submissionsSnapshot = await getDocs(
        query(
          collection(db, 'submissions'),
          where('activityId', '==', currentActivity.id)
          //where('studentEmail', '!=', studentEmail) // Exclude own submission // Removed so student can evaluate any paper that is not theirs in the future
        )
      );

      const submissions = submissionsSnapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((submission) => submission.studentEmail !== studentEmail); // Filter out the student's own submission

      // Algorithm to sort submissions for the current round
      if (currentRound === 1) {
        // Round 1: Pair based on student ID
        submissions.sort((a, b) => a.studentId - b.studentId);
      } else {
        // Subsequent rounds: Sort based on scores, then randomize ties
        const evaluations = await getDocs(
          query(
            collection(db, 'evaluations'),
            where('activityId', '==', currentActivity.id)
          )
        );
        const scores = {};
        evaluations.forEach((doc) => {
          const evaluation = doc.data();
          scores[evaluation.winner] = (scores[evaluation.winner] || 0) + 1;
        });

        submissions.sort((a, b) => {
          const scoreA = scores[a.id] || 0;
          const scoreB = scores[b.id] || 0;
          if (scoreA !== scoreB) {
            return scoreB - scoreA; // Sort by score descending
          }
          return Math.random() - 0.5; // Randomize if scores are equal
        });
      }

      // Find a suitable pair for the student based on studentId
      if (currentRound === 1) {
        // Round 1 pairing logic
        let leftIndex = (studentId - 1) % submissions.length;
        let rightIndex = studentId % submissions.length;

        if (leftIndex === rightIndex) {
          rightIndex = (rightIndex + 1) % submissions.length;
        }

        setEvaluationPair({
          left: submissions[leftIndex],
          right: submissions[rightIndex],
        });
      } else {
        // Subsequent rounds pairing logic
        for (let i = 0; i < submissions.length; i++) {
          for (let j = i + 1; j < submissions.length; j++) {
            const pair = [submissions[i], submissions[j]];
            const pairIds = pair.map((submission) => submission.id).sort();

            // Check if this pair has been evaluated before
            const hasEvaluatedPair = evaluationsSnapshot.docs.some((doc) => {
              const evalData = doc.data();
              const evaluatedPair = [
                evalData.leftSubmissionId,
                evalData.rightSubmissionId,
              ].sort();
              return (
                JSON.stringify(evaluatedPair) === JSON.stringify(pairIds) &&
                evalData.round === currentRound
              );
            });

            const hasEvaluatedSubmissions = pair.some((submission) =>
              evaluatedSubmissions.has(submission.id)
            );

            if (!hasEvaluatedPair && !hasEvaluatedSubmissions) {
              setEvaluationPair({
                left: pair[0],
                right: pair[1],
              });
              return; // Found a pair, exit the loop
            }
          }
        }
      }
    };

    if (
      currentActivity &&
      phase === 'evaluate' &&
      studentEmail &&
      studentId &&
      !evaluationSubmitted
    ) {
      getEvaluationPair();
    }
  }, [currentActivity, phase, studentEmail, studentId, evaluationSubmitted]);

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
    if (evaluationSubmitted) {
      return (
        <div className="p-8">
          <h1 className="text-2xl">
            Your evaluation for this round has been submitted.
          </h1>
          <p>Please wait for the next round or final results.</p>
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
                <p>{evaluationPair?.left.content}</p>
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
                <p>{evaluationPair?.right.content}</p>
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
    } else {
      // No evaluation pair yet, show a waiting message
      return (
        <div className="p-8">
          <h1 className="text-2xl">Waiting for evaluation pair...</h1>
          {/* You can add a loading spinner or other indicator here */}
        </div>
      );
    }
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
