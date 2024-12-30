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
  getDoc,
  orderBy,  // Add this
  limit     // Add this
} from 'firebase/firestore';
import {
  runEvaluationRound,
  resetEvaluationManager
} from './evaluationManager';
import { runSimulation } from './simulationTest';

function Admin() {
  const [phase, setPhase] = useState('init');
  const [activityName, setActivityName] = useState('');
  const [currentActivity, setCurrentActivity] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [hideRankingNames, setHideRankingNames] = useState(false);
  const [hideNames, setHideNames] = useState(false);
  const [pendingEvaluators, setPendingEvaluators] = useState([]);
  const [isResetting, setIsResetting] = useState(false);

  // In Admin.jsx, add initial activity fetch
  // Add this at the beginning right after the state declarations
  useEffect(() => {
    const fetchCurrentActivity = async () => {
      try {
        // Query the most recent activity
        const activitiesQuery = query(
          collection(db, 'activities'),
          orderBy('currentRound', 'desc'),
          limit(1)
        );

        const activitiesSnapshot = await getDocs(activitiesQuery);

        if (!activitiesSnapshot.empty) {
          const activity = {
            id: activitiesSnapshot.docs[0].id,
            ...activitiesSnapshot.docs[0].data()
          };
          console.log('Found existing activity:', activity);
          setCurrentActivity(activity);
          setPhase(activity.phase);
          setActivityName(activity.name);
        } else {
          console.log('No existing activity found, starting fresh');
          setPhase('init');
        }
      } catch (error) {
        console.error('Error fetching current activity:', error);
        setPhase('init');
      }
    };

    fetchCurrentActivity();
  }, []); // Empty dependency array means this runs once on mount

  // Then update the existing activity listener useEffect to handle both creation and updates
  useEffect(() => {
    if (!currentActivity) return;

    console.log('Setting up activity listener for:', currentActivity.id);

    const unsubscribe = onSnapshot(
      doc(db, 'activities', currentActivity.id),
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setPhase(data.phase);
          console.log('Activity updated:', data);
        } else {
          // Activity was deleted
          console.log('Activity no longer exists');
          setPhase('init');
          setCurrentActivity(null);
          setActivityName('');
        }
      },
      (error) => {
        console.error('Error listening to activity:', error);
      }
    );

    return () => unsubscribe();
  }, [currentActivity?.id]); // Only re-run if activity ID changes

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


  // Update the getPendingEvaluators useEffect with proper checks
  useEffect(() => {
    const getPendingEvaluators = async () => {
      // Exit early if we don't have an activity ID or we're not in evaluate phase
      if (!currentActivity?.id || phase !== 'evaluate') {
        setPendingEvaluators([]);
        return;
      }
  
      try {
        // Get all submissions for this activity
        const submissionsSnapshot = await getDocs(
          query(collection(db, 'submissions'),
            where('activityId', '==', currentActivity.id))
        );
  
        // Get all evaluations for current round
        const evaluationsSnapshot = await getDocs(
          query(collection(db, 'evaluations'),
            where('activityId', '==', currentActivity.id),
            where('round', '==', currentActivity?.currentRound || 1))
        );
  
        // Create a map of evaluator email to number of evaluations completed
        const evaluatorCounts = {};
        evaluationsSnapshot.docs.forEach(doc => {
          const evaluatorEmail = doc.data().evaluatorEmail;
          evaluatorCounts[evaluatorEmail] = (evaluatorCounts[evaluatorEmail] || 0) + 1;
        });
  
        // Get all students who should evaluate
        const allEvaluators = submissionsSnapshot.docs.map(doc => ({
          name: doc.data().studentName,
          email: doc.data().studentEmail,
          evaluationsCompleted: evaluatorCounts[doc.data().studentEmail] || 0,
          evaluationsRequired: 1  // Each student evaluates one pair per round
        }));
  
        // Filter for pending evaluators (those who haven't completed their evaluation for this round)
        const pending = allEvaluators.filter(
          evaluator => evaluator.evaluationsCompleted < evaluator.evaluationsRequired
        );
  
        setPendingEvaluators(pending);
      } catch (error) {
        console.error('Error getting pending evaluators:', error);
      }
    };
  
    getPendingEvaluators();
  }, [currentActivity?.id, phase, evaluations, currentActivity?.currentRound]);

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

      // Delete all students
      const studentsSnapshot = await getDocs(collection(db, 'students'));
      for (const doc of studentsSnapshot.docs) {
        await deleteDoc(doc.ref);
      }

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

      // Reset evaluation manager
      resetEvaluationManager();

      // Reset all local state
      setPhase('init');
      setActivityName('');
      setCurrentActivity(null);
      setSubmissions([]);
      setEvaluations([]);
      setRankings([]);

      // Clear localStorage
      localStorage.clear();

      console.log('Application reset complete');
    } catch (error) {
      console.error('Error resetting application:', error);
    } finally {
      setIsResetting(false);
    }
  };

  const SimulationButton = () => {
    const [isSimulating, setIsSimulating] = useState(false);
    const [simulationResults, setSimulationResults] = useState(null);
  
    const handleSimulation = async () => {
      if (isSimulating) return;
      
      try {
        setIsSimulating(true);
        const results = await runSimulation();
        setSimulationResults(results);
        
        // Print formatted results
        console.log('\n=== Simulation Results ===');
        results.rounds.forEach(round => {
          console.log(`\nRound ${round.round}`);
          console.log('Evaluator | Pair evaluated | Winner');
          console.log('----------|----------------|--------');
          round.evaluations.forEach(evaluation => {
            const evaluatorId = evaluation.evaluator.match(/\d+/)[0].padStart(2, '0');
            const pair1 = evaluation.pair[0].match(/\d+/)[0].padStart(2, '0');
            const pair2 = evaluation.pair[1].match(/\d+/)[0].padStart(2, '0');
            const winnerId = String(evaluation.winner).padStart(2, '0');
            console.log(`   ${evaluatorId}    |   ${pair1} vs ${pair2}   |   ${winnerId}`);
          });
        });
        
      } catch (error) {
        console.error('Simulation failed:', error);
        alert('Simulation failed. Check console for details.');
      } finally {
        setIsSimulating(false);
      }
    };
  
    return (
      <div className="fixed top-4 left-4 flex flex-col items-start space-y-4">
        <button
          onClick={handleSimulation}
          disabled={isSimulating}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow-md transition-colors duration-200"
        >
          {isSimulating ? 'Running Simulation...' : 'Run 30-Student Simulation'}
        </button>
        
        {simulationResults && (
          <div className="bg-white p-4 rounded shadow-md max-w-2xl max-h-96 overflow-auto">
            <h3 className="font-bold mb-2">Simulation Results</h3>
            {simulationResults.rounds.map((round) => (
              <div key={round.round} className="mb-6">
                <h4 className="font-semibold mb-2">Round {round.round}</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1">Evaluator</th>
                      <th className="text-left py-1">Pair evaluated</th>
                      <th className="text-left py-1">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {round.evaluations.map((evaluation, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-1">{evaluation.evaluator.match(/\d+/)[0].padStart(2, '0')}</td>
                        <td className="py-1">
                          {evaluation.pair[0].match(/\d+/)[0].padStart(2, '0')} vs{' '}
                          {evaluation.pair[1].match(/\d+/)[0].padStart(2, '0')}
                        </td>
                        <td className="py-1">{String(evaluation.winner).padStart(2, '0')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    );
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

    try {
      console.log('Starting evaluation phase...');

      // Run evaluation round and get assignments
      const evaluators = await runEvaluationRound(currentActivity.id);
      console.log('Evaluators assigned:', evaluators);

      // Update activity document with phase, round, and assignments
      await updateDoc(doc(db, 'activities', currentActivity.id), {
        phase: 'evaluate',
        currentRound: 1,
        hideNames: hideNames,
        evaluatorAssignments: evaluators // Store the assignments
      });

      console.log('Updated activity with assignments:', {
        phase: 'evaluate',
        currentRound: 1,
        evaluatorAssignments: evaluators
      });

      setPhase('evaluate');
    } catch (error) {
      console.error('Error starting evaluation:', error);
    }
  };

  // Update startNextRound in Admin.jsx
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

      // Run evaluation round and get new assignments
      const evaluators = await runEvaluationRound(currentActivity.id);
      console.log('New evaluator assignments:', evaluators);

      // Update the activity with new round number and assignments
      const updateData = {
        currentRound: currentRound + 1,
        phase: 'evaluate',
        evaluatorAssignments: evaluators,
        hideNames: hideNames,
      };

      await updateDoc(doc(db, 'activities', currentActivity.id), updateData);
      console.log('Successfully updated activity with:', updateData);

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
    calculateCurrentRankings();
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


  const exportData = async () => {
    if (!currentActivity) return;
  
    try {
      // Fetch all relevant data
      const submissionsSnapshot = await getDocs(
        query(collection(db, 'submissions'),
          where('activityId', '==', currentActivity.id))
      );
      
      const evaluationsSnapshot = await getDocs(
        query(collection(db, 'evaluations'),
          where('activityId', '==', currentActivity.id))
      );
  
      const submissions = submissionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      const evaluations = evaluationsSnapshot.docs.map(doc => doc.data());
  
      // Group comments by submission
      const submissionComments = {};
      evaluations.forEach(ev => {
        // Add left submission comments
        if (ev.leftComments && ev.leftSubmissionId) {
          if (!submissionComments[ev.leftSubmissionId]) {
            submissionComments[ev.leftSubmissionId] = [];
          }
          submissionComments[ev.leftSubmissionId].push({
            comment: ev.leftComments,
            evaluator: ev.evaluatorEmail,
            round: ev.round
          });
        }
        
        // Add right submission comments
        if (ev.rightComments && ev.rightSubmissionId) {
          if (!submissionComments[ev.rightSubmissionId]) {
            submissionComments[ev.rightSubmissionId] = [];
          }
          submissionComments[ev.rightSubmissionId].push({
            comment: ev.rightComments,
            evaluator: ev.evaluatorEmail,
            round: ev.round
          });
        }
      });
  
      // Format comments for each submission
      const formatComments = (submissionId) => {
        const comments = submissionComments[submissionId] || [];
        return comments
          .filter(c => c.comment) // Only include non-empty comments
          .map(c => `Round ${c.round}: ${c.comment} (${c.evaluator})`)
          .join('\n');
      };
  
      // Create CSV content
      const csvContent = [
        // Headers
        ['Student Name', 'Email', 'Submission', 'Points', 'Comments Received'].join(','),
        // Data rows
        ...submissions.map(sub => {
          const formattedComments = formatComments(sub.id);
          return [
            sub.studentName,
            sub.studentEmail,
            `"${sub.content?.content ? sub.content.content.replace(/"/g, '""') : sub.content?.replace(/"/g, '""')}"`,
            rankings.find(r => r.id === sub.id)?.score || 0,
            `"${formattedComments.replace(/"/g, '""')}"`
          ].join(',');
        })
      ].join('\n');
  
      // Download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${currentActivity.name}_results.csv`;
      link.click();
    } catch (error) {
      console.error('Error exporting data:', error);
    }
  };




  if (phase === 'init') {
    return (
      <div className="container">
        <ResetButton />
        <SimulationButton />
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
          <div className="mb-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hideNames}
                onChange={(e) => setHideNames(e.target.checked)}
                className="form-checkbox"
              />
              <span>Hide Student Names During Evaluation</span>
            </label>
          </div>
          <button onClick={startEvaluation} className="btn btn-primary">
            Start Round 1
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'evaluate') {
    const totalPossibleEvaluations = submissions.length;

    return (
      <div className="container mx-auto p-8">
        <ResetButton />
        <div className="space-y-8">
          <h1 className="text-2xl font-bold">Evaluation Phase</h1>

          {/* Progress section */}
          <div className="bg-white p-6 rounded-lg shadow">
  <h2 className="text-xl font-semibold mb-4">Progress</h2>
  <p className="text-lg mb-2">
    Completed evaluations: {evaluations.length} / {submissions.length}
  </p>
  {submissions.length > 0 && (
    <>
      {pendingEvaluators.length > 0 ? (
        <p className="text-red-600">
          Pending: {pendingEvaluators.map(e => e.name).join(' ')}
        </p>
      ) : (
        <p className="text-green-600">All evaluations completed!</p>
      )}
    </>
  )}
</div>

          <div className="mb-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hideRankingNames}
                onChange={(e) => setHideRankingNames(e.target.checked)}
                className="form-checkbox"
              />
              <span>Hide Names in Rankings</span>
            </label>
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
                        {hideRankingNames ? 'Anonymous' : submission.studentName}
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
          <h2 className="text-xl font-semibold mb-4">Final Rankings</h2>
          <div className="mb-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hideRankingNames}
                onChange={(e) => setHideRankingNames(e.target.checked)}
                className="form-checkbox"
              />
              <span>Hide Names in Rankings</span>
            </label>
          </div>

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
                      {hideRankingNames ? 'Anonymous' : submission.studentName}
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
        <button
          onClick={exportData}
          className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded mt-4"
        >
          Export Results
        </button>
      </div>
    );
  }

  return null;
}

export default Admin;
