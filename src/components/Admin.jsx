//Admin.jsx
import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  deleteDoc,
  getDoc
} from 'firebase/firestore';

function Admin() {
  const [phase, setPhase] = useState('init');
  const [activityName, setActivityName] = useState('');
  const [currentActivity, setCurrentActivity] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (!currentActivity) return;
  
    const unsubscribe = onSnapshot(
      doc(db, 'activities', currentActivity.id),
      (doc) => {
        const data = doc.data();
        setPhase(data.phase);
        console.log('Activity updated:', data); // Debug log
      }
    );
  
    return () => unsubscribe();
  }, [currentActivity]);

  useEffect(() => {
    if (!currentActivity) return;

    const q = query(
      collection(db, 'submissions'),
      where('activityId', '==', currentActivity.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSubmissions(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });

    return () => unsubscribe();
  }, [currentActivity]);

  useEffect(() => {
    if (!currentActivity) return;

    const q = query(
      collection(db, 'evaluations'),
      where('activityId', '==', currentActivity.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEvaluations(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );

      // Calculate rankings whenever evaluations change
      calculateCurrentRankings(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });

    return () => unsubscribe();
  }, [currentActivity]); // Removed `submissions` from the dependency array

  const resetApplication = async () => {
    if (isResetting) return;

    try {
      setIsResetting(true);

      // Delete all submissions
      const submissionsSnapshot = await getDocs(collection(db, 'submissions'));
      for (const doc of submissionsSnapshot.docs) {
        await deleteDoc(doc.ref);
      }

      // Delete all evaluations
      const evaluationsSnapshot = await getDocs(collection(db, 'evaluations'));
      for (const doc of evaluationsSnapshot.docs) {
        await deleteDoc(doc.ref);
      }

      // Delete all activities
      const activitiesSnapshot = await getDocs(collection(db, 'activities'));
      for (const doc of activitiesSnapshot.docs) {
        await deleteDoc(doc.ref);
      }

      // Reset local state
      setPhase('init');
      setActivityName('');
      setCurrentActivity(null);
      setSubmissions([]);
      setEvaluations([]);
      setRankings([]);
    } catch (error) {
      console.error('Error resetting application:', error);
    } finally {
      setIsResetting(false);
    }
  };

  const startActivity = async () => {
    const activityRef = await addDoc(collection(db, 'activities'), {
      name: activityName,
      phase: 'submit',
      currentRound: 0,
    });

    setCurrentActivity({ id: activityRef.id });
    setPhase('submit');
  };

  const startEvaluation = async () => {
    if (!currentActivity) return;

    await updateDoc(doc(db, 'activities', currentActivity.id), {
      phase: 'evaluate',
      currentRound: 1,
    });
    setPhase('evaluate');
  };

  
const startNextRound = async () => {
  if (!currentActivity) {
    console.error('No current activity found');
    return;
  }

  try {
    console.log('Starting next round...');
    
    // Get the current activity data
    const activityDoc = await getDoc(doc(db, 'activities', currentActivity.id));
    
    if (!activityDoc.exists()) {
      console.error('Activity document not found');
      return;
    }

    const activityData = activityDoc.data();
    console.log('Current activity data:', activityData);
    
    const currentRound = activityData.currentRound || 1;
    console.log('Current round:', currentRound);
    
    // Update the activity with new round number
    await updateDoc(doc(db, 'activities', currentActivity.id), {
      currentRound: currentRound + 1,
      phase: 'evaluate'  // Ensure we stay in evaluate phase
    });
    
    console.log('Successfully updated to round:', currentRound + 1);
    
    // Reset evaluation states for students
    const evaluationsRef = collection(db, 'evaluations');
    const roundEvaluationsQuery = query(
      evaluationsRef,
      where('activityId', '==', currentActivity.id),
      where('round', '==', currentRound)
    );
    
    // Log the number of evaluations for the current round
    const evaluationsSnapshot = await getDocs(roundEvaluationsQuery);
    console.log(`Found ${evaluationsSnapshot.docs.length} evaluations for round ${currentRound}`);

  } catch (error) {
    console.error('Error starting next round:', error);
  }
};

  const endEvaluation = async () => {
    if (!currentActivity) return;

    await updateDoc(doc(db, 'activities', currentActivity.id), {
      phase: 'final',
    });
    setPhase('final');
    calculateFinalRankings();
  };

  const calculateCurrentRankings = async (currentEvaluations) => {
    const scores = {};

    // Fetch the latest submissions from the database
    const submissionsSnapshot = await getDocs(
      query(
        collection(db, 'submissions'),
        where('activityId', '==', currentActivity.id)
      )
    );
    const currentSubmissions = submissionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Initialize scores for all submissions
    currentSubmissions.forEach((submission) => {
      scores[submission.id] = 0;
    });

    // Count wins for each submission
    currentEvaluations.forEach((evaluation) => {
      scores[evaluation.winner] = (scores[evaluation.winner] || 0) + 1;
    });

    // Create sorted rankings with all submissions
    const sortedRankings = currentSubmissions
      .map((submission) => ({
        ...submission,
        score: scores[submission.id] || 0,
      }))
      .sort((a, b) => b.score - a.score);

    setRankings(sortedRankings);
  };

  const calculateFinalRankings = async () => {
    const evaluationsSnapshot = await getDocs(
      query(
        collection(db, 'evaluations'),
        where('activityId', '==', currentActivity.id)
      )
    );

    const scores = {};
    evaluationsSnapshot.forEach((doc) => {
      const evaluation = doc.data();
      scores[evaluation.winner] = (scores[evaluation.winner] || 0) + 1;
    });

    const sortedRankings = Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .map(([submissionId, score]) => ({
        ...submissions.find((s) => s.id === submissionId),
        score,
      }));

    setRankings(sortedRankings);
  };

  // Reset button that's always present
  const ResetButton = () => (
    <button
      onClick={resetApplication}
      disabled={isResetting}
      className="fixed top-4 right-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded shadow-md transition-colors duration-200"
    >
      {isResetting ? 'Resetting...' : 'Reset Application'}
    </button>
  );

  if (phase === 'init') {
    return (
      <div className="container">
        <ResetButton />
        <div className="card">
          <h1 className="text-2xl font-bold mb-6">Initialize Activity</h1>
          <input
            type="text"
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            placeholder="Activity Name"
            className="input"
          />
          <button onClick={startActivity} className="btn btn-primary">
            Start
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'submit') {
    return (
      <div className="container">
        <ResetButton />
        <div className="card">
          <h1 className="text-2xl font-bold mb-6">Submission Phase</h1>
          <p className="mb-4">Number of submissions: {submissions.length}</p>
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-2">Submitted students:</h2>
            <ul className="space-y-2">
              {submissions.map((sub) => (
                <li key={sub.id} className="text-gray-700">
                  {sub.studentName}
                </li>
              ))}
            </ul>
          </div>
          <button onClick={startEvaluation} className="btn btn-primary">
            Start Round 1
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'evaluate') {
    const totalPossibleEvaluations =
      (submissions.length * (submissions.length - 1)) / 2;

    return (
      <div className="container mx-auto p-8">
        <ResetButton />
        <div className="space-y-8">
          <h1 className="text-2xl font-bold">Evaluation Phase</h1>

          {/* Progress section */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Progress</h2>
            <p className="text-lg">
              Completed evaluations: {evaluations.length} /{' '}
              {totalPossibleEvaluations}
            </p>
          </div>

          {/* Current Rankings Table */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Current Rankings</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rank
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {rankings.map((submission, index) => (
                    <tr key={submission.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {submission.studentName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {submission.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4">
            <button
              onClick={startNextRound}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded shadow transition-colors duration-200"
            >
              Start Next Round
            </button>
            <button
              onClick={endEvaluation}
              className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded shadow transition-colors duration-200"
            >
              End Evaluation
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (phase === 'final') {
    return (
      <div className="container">
        <ResetButton />
        <div className="card">
          <h1 className="text-2xl font-bold mb-6">Final Rankings</h1>
          <ol className="space-y-3">
            {rankings.map((submission, index) => (
              <li key={submission.id} className="text-gray-700">
                {`${index + 1}. ${submission.studentName} (Score: ${
                  submission.score
                })`}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return null;
}

export default Admin;
