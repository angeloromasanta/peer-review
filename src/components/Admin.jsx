//admin.jsx
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
  orderBy,
  limit,
  writeBatch
} from 'firebase/firestore';
import {
  runEvaluationRound,
  resetEvaluationManager
} from './evaluationManager';
import { runSimulation } from './simulationTest';

function Admin() {
  // Activity Management State
  const [activities, setActivities] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [newActivityName, setNewActivityName] = useState('');
  const [isCreatingActivity, setIsCreatingActivity] = useState(false);
  const [isDeletingActivity, setIsDeletingActivity] = useState(false);

  // Current Activity State
  const [phase, setPhase] = useState('init');
  const [submissions, setSubmissions] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [hideRankingNames, setHideRankingNames] = useState(false);
  const [hideNames, setHideNames] = useState(false);
  const [pendingEvaluators, setPendingEvaluators] = useState([]);
  const [isResettingRound, setIsResettingRound] = useState(false);
  const [isResettingEvaluations, setIsResettingEvaluations] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Fetch all activities
  useEffect(() => {
    const q = query(collection(db, 'activities'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activityList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setActivities(activityList);
    });

    return () => unsubscribe();
  }, []);

  // Listen to selected activity changes
  useEffect(() => {
    if (!selectedActivity?.id) return;

    const unsubscribe = onSnapshot(
      doc(db, 'activities', selectedActivity.id),
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setSelectedActivity({ id: doc.id, ...data });
          setPhase(data.phase);
        } else {
          // Activity was deleted
          setSelectedActivity(null);
          setPhase('init');
        }
      }
    );

    return () => unsubscribe();
  }, [selectedActivity?.id]);

  // Listen to submissions for selected activity
  useEffect(() => {
    if (!selectedActivity?.id) return;

    const q = query(
      collection(db, 'submissions'),
      where('activityId', '==', selectedActivity.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSubmissions(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });

    return () => unsubscribe();
  }, [selectedActivity?.id]);

  // Listen to evaluations for selected activity
  useEffect(() => {
    if (!selectedActivity?.id) return;

    const q = query(
      collection(db, 'evaluations'),
      where('activityId', '==', selectedActivity.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const currentEvaluations = snapshot.docs.map((doc) => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      setEvaluations(currentEvaluations);
      calculateCurrentRankings(currentEvaluations);
    });

    return () => unsubscribe();
  }, [selectedActivity?.id]);

  // Track pending evaluators
  useEffect(() => {
    const getPendingEvaluators = async () => {
      if (!selectedActivity?.id || phase !== 'evaluate') {
        setPendingEvaluators([]);
        return;
      }

      try {
        const submissionsSnapshot = await getDocs(
          query(collection(db, 'submissions'),
            where('activityId', '==', selectedActivity.id))
        );

        const evaluationsSnapshot = await getDocs(
          query(collection(db, 'evaluations'),
            where('activityId', '==', selectedActivity.id),
            where('round', '==', selectedActivity?.currentRound || 1))
        );

        const evaluatorCounts = {};
        evaluationsSnapshot.docs.forEach(doc => {
          const evaluatorEmail = doc.data().evaluatorEmail;
          evaluatorCounts[evaluatorEmail] = (evaluatorCounts[evaluatorEmail] || 0) + 1;
        });

        const allEvaluators = submissionsSnapshot.docs.map(doc => ({
          name: doc.data().studentName,
          email: doc.data().studentEmail,
          evaluationsCompleted: evaluatorCounts[doc.data().studentEmail] || 0,
          evaluationsRequired: 1
        }));

        const pending = allEvaluators.filter(
          evaluator => evaluator.evaluationsCompleted < evaluator.evaluationsRequired
        );

        setPendingEvaluators(pending);
      } catch (error) {
        console.error('Error getting pending evaluators:', error);
      }
    };

    getPendingEvaluators();
  }, [selectedActivity?.id, phase, evaluations, selectedActivity?.currentRound]);

  // Activity Management Functions
  const createActivity = async () => {
    if (!newActivityName.trim() || isCreatingActivity) return;

    try {
      setIsCreatingActivity(true);

      // Deactivate all other activities
      const batch = writeBatch(db);
      const activeActivities = activities.filter(a => a.isActive);
      activeActivities.forEach(activity => {
        const activityRef = doc(db, 'activities', activity.id);
        batch.update(activityRef, { isActive: false });
      });
      await batch.commit();

      // Create new activity
      const activityRef = await addDoc(collection(db, 'activities'), {
        name: newActivityName,
        phase: 'submit',
        currentRound: 0,
        isActive: true,
        createdAt: new Date().toISOString()
      });

      setSelectedActivity({ id: activityRef.id });
      setPhase('submit');
      setNewActivityName('');
    } catch (error) {
      console.error('Error creating activity:', error);
    } finally {
      setIsCreatingActivity(false);
    }
  };

  const deleteActivity = async (activityId) => {
    if (isDeletingActivity) return;
    if (!window.confirm('Are you sure you want to delete this activity? This will remove all related submissions and evaluations.')) return;

    try {
      setIsDeletingActivity(true);

      // Delete all related submissions
      const submissionsSnapshot = await getDocs(
        query(collection(db, 'submissions'), where('activityId', '==', activityId))
      );
      
      // Delete all related evaluations
      const evaluationsSnapshot = await getDocs(
        query(collection(db, 'evaluations'), where('activityId', '==', activityId))
      );

      // Use batch to delete everything
      const batch = writeBatch(db);
      
      submissionsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      evaluationsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      batch.delete(doc(db, 'activities', activityId));
      
      await batch.commit();

      if (selectedActivity?.id === activityId) {
        setSelectedActivity(null);
        setPhase('init');
      }
    } catch (error) {
      console.error('Error deleting activity:', error);
    } finally {
      setIsDeletingActivity(false);
    }
  };

  const setActivityActive = async (activityId) => {
    try {
      const batch = writeBatch(db);

      // Deactivate all activities
      activities.forEach(activity => {
        const activityRef = doc(db, 'activities', activity.id);
        batch.update(activityRef, { isActive: activity.id === activityId });
      });

      await batch.commit();
    } catch (error) {
      console.error('Error setting activity active:', error);
    }
  };

  // Reset Functions
  const resetCurrentRound = async () => {
    if (!selectedActivity?.id || isResettingRound) return;
    if (!window.confirm('Are you sure you want to reset the current round? This will delete all evaluations from this round.')) return;

    try {
      setIsResettingRound(true);

      const currentRound = selectedActivity.currentRound;
      
      // Delete evaluations for current round
      const evaluationsSnapshot = await getDocs(
        query(
          collection(db, 'evaluations'),
          where('activityId', '==', selectedActivity.id),
          where('round', '==', currentRound)
        )
      );

      const batch = writeBatch(db);
      evaluationsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // Reset evaluation manager for current round
      resetEvaluationManager();

      // Reassign evaluators
      const evaluators = await runEvaluationRound(selectedActivity.id);

      // Update activity
      await updateDoc(doc(db, 'activities', selectedActivity.id), {
        evaluatorAssignments: evaluators
      });

    } catch (error) {
      console.error('Error resetting current round:', error);
    } finally {
      setIsResettingRound(false);
    }
  };

  const resetAllEvaluations = async () => {
    if (!selectedActivity?.id || isResettingEvaluations) return;
    if (!window.confirm('Are you sure you want to reset all evaluations? This will delete all evaluation data.')) return;

    try {
      setIsResettingEvaluations(true);

      // Delete all evaluations
      const evaluationsSnapshot = await getDocs(
        query(collection(db, 'evaluations'), 
          where('activityId', '==', selectedActivity.id))
      );

      const batch = writeBatch(db);
      evaluationsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // Reset evaluation manager
      resetEvaluationManager();

      // Update activity to submission phase
      await updateDoc(doc(db, 'activities', selectedActivity.id), {
        phase: 'submit',
        currentRound: 0,
        evaluatorAssignments: null
      });

      setPhase('submit');
    } catch (error) {
      console.error('Error resetting evaluations:', error);
    } finally {
      setIsResettingEvaluations(false);
    }
  };

  // Phase Management Functions
  const startEvaluation = async () => {
    if (!selectedActivity?.id) return;

    try {
      console.log('Starting evaluation phase...');

      const evaluators = await runEvaluationRound(selectedActivity.id);
      console.log('Evaluators assigned:', evaluators);

      await updateDoc(doc(db, 'activities', selectedActivity.id), {
        phase: 'evaluate',
        currentRound: 1,
        hideNames: hideNames,
        evaluatorAssignments: evaluators
      });

      setPhase('evaluate');
    } catch (error) {
      console.error('Error starting evaluation:', error);
    }
  };

  const startNextRound = async () => {
    if (!selectedActivity?.id) return;

    try {
      const activityDoc = await getDoc(doc(db, 'activities', selectedActivity.id));
      if (!activityDoc.exists()) return;

      const activityData = activityDoc.data();
      const currentRound = activityData.currentRound || 1;

      const evaluators = await runEvaluationRound(selectedActivity.id);

      await updateDoc(doc(db, 'activities', selectedActivity.id), {
        currentRound: currentRound + 1,
        phase: 'evaluate',
        evaluatorAssignments: evaluators,
        hideNames: hideNames,
      });

    } catch (error) {
      console.error('Error starting next round:', error);
    }
  };

  const endEvaluation = async () => {
    if (!selectedActivity?.id) return;

    await updateDoc(doc(db, 'activities', selectedActivity.id), {
      phase: 'final',
    });
    setPhase('final');
    calculateCurrentRankings(evaluations);
  };

  // Utility Functions
  const calculateCurrentRankings = async (currentEvaluations) => {
    if (!selectedActivity?.id) return;
  
    const scores = {};
    const starCounts = {};
  
    const submissionsSnapshot = await getDocs(
      query(
        collection(db, 'submissions'),
        where('activityId', '==', selectedActivity.id)
      )
    );
    
    const currentSubmissions = submissionsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  
    // Initialize scores and star counts
    currentSubmissions.forEach((submission) => {
      scores[submission.id] = 0;
      starCounts[submission.studentEmail] = 0;
    });
  
    // Calculate submission scores
    currentEvaluations.forEach((evaluation) => {
      scores[evaluation.winner] = (scores[evaluation.winner] || 0) + 1;
      
      // Count stars received for comments
      if (evaluation.stars?.length > 0) {
        starCounts[evaluation.evaluatorEmail] = 
          (starCounts[evaluation.evaluatorEmail] || 0) + evaluation.stars.length;
      }
    });
  
    const sortedRankings = currentSubmissions
      .map((submission) => ({
        ...submission,
        score: scores[submission.id] || 0,
        starsReceived: starCounts[submission.studentEmail] || 0
      }))
      .sort((a, b) => b.score - a.score);
  
    setRankings(sortedRankings);
  };

  const exportData = async () => {
    if (!selectedActivity?.id || isExporting) return;

    try {
      setIsExporting(true);

      const submissionsSnapshot = await getDocs(
        query(collection(db, 'submissions'),
          where('activityId', '==', selectedActivity.id))
      );
      
      const evaluationsSnapshot = await getDocs(
        query(collection(db, 'evaluations'),
          where('activityId', '==', selectedActivity.id))
      );

      const submissions = submissionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      const evaluations = evaluationsSnapshot.docs.map(doc => doc.data());

      const submissionComments = {};
      evaluations.forEach(ev => {
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

      const formatComments = (submissionId) => {
        const comments = submissionComments[submissionId] || [];
        return comments
          .filter(c => c.comment)
          .map(c => `Round ${c.round}: ${c.comment} (${c.evaluator})`)
          .join('\n');
      };

      const csvContent = [
        ['Student Name', 'Email', 'Submission', 'Points', 'Stars Received', 'Comments Received'].join(','),
        ...submissions.map(sub => {
          const formattedComments = formatComments(sub.id);
          const rankingData = rankings.find(r => r.id === sub.id);
          return [
            sub.studentName,
            sub.studentEmail,
            `"${sub.content?.content ? sub.content.content.replace(/"/g, '""') : sub.content?.replace(/"/g, '""')}"`,
            rankingData?.score || 0,
            rankingData?.starsReceived || 0,
            `"${formattedComments.replace(/"/g, '""')}"`
          ].join(',');
        })
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${selectedActivity.name}_results.csv`;
      link.click();
    } catch (error) {
      console.error('Error exporting data:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // Render Functions
  const renderActivityList = () => {
    return (
      <div className="container mx-auto p-8">
        <h1 className="text-2xl font-bold mb-6">Activity Management</h1>
        
        {/* Create New Activity */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-semibold mb-4">Create New Activity</h2>
          <div className="flex gap-4">
            <input
              type="text"
              value={newActivityName}
              onChange={(e) => setNewActivityName(e.target.value)}
              placeholder="Activity Name"
              className="flex-1 p-2 border rounded"
            />
            <button
              onClick={createActivity}
              disabled={isCreatingActivity || !newActivityName.trim()}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
            >
              {isCreatingActivity ? 'Creating...' : 'Create Activity'}
            </button>
          </div>
        </div>
  
        {/* Activity List */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Existing Activities</h2>
          <div className="space-y-4">
            {activities.map(activity => (
              <div key={activity.id} className="border p-4 rounded flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{activity.name}</h3>
                  <p className="text-sm text-gray-600">
                    Phase: {activity.phase}, Round: {activity.currentRound || 0}
                  </p>
                  <p className="text-sm text-gray-600">
                    Status: {activity.isActive ? 'Active' : 'Inactive'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedActivity(activity)}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                  >
                    Manage
                  </button>
                  <button
                    onClick={() => setActivityActive(activity.id)}
                    className={`${
                      activity.isActive ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-500 hover:bg-gray-600'
                    } text-white px-4 py-2 rounded`}
                  >
                    {activity.isActive ? 'Active' : 'Set Active'}
                  </button>
                  <button
                    onClick={() => deleteActivity(activity.id)}
                    disabled={isDeletingActivity}
                    className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded disabled:opacity-50"
                  >
                    {isDeletingActivity ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
            {activities.length === 0 && (
              <p className="text-gray-500 text-center">No activities created yet</p>
            )}
          </div>
        </div>
  
        {/* Global Reset Button */}
        <div className="fixed bottom-4 right-4">
          <button
            onClick={async () => {
              if (!window.confirm('⚠️ WARNING: This will permanently delete ALL data from ALL activities. Are you absolutely sure?')) return;
              
              try {
                const batch = writeBatch(db);
                
                // Delete all students
                const studentsSnapshot = await getDocs(collection(db, 'students'));
                studentsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                
                // Delete all submissions
                const submissionsSnapshot = await getDocs(collection(db, 'submissions'));
                submissionsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                
                // Delete all evaluations
                const evaluationsSnapshot = await getDocs(collection(db, 'evaluations'));
                evaluationsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                
                // Delete all activities
                const activitiesSnapshot = await getDocs(collection(db, 'activities'));
                activitiesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                
                await batch.commit();
                
                // Reset local state
                setActivities([]);
                setNewActivityName('');
                
                console.log('All data deleted successfully');
              } catch (error) {
                console.error('Error deleting all data:', error);
                alert('Failed to delete all data. Check console for details.');
              }
            }}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg shadow-lg font-bold"
          >
            Delete All Data
          </button>
        </div>
      </div>
    );
  };

  const renderActivityHeader = () => {
    if (!selectedActivity) return null;

    return (
      <div className="bg-white p-4 shadow mb-8">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSelectedActivity(null)}
              className="text-gray-600 hover:text-gray-800"
            >
              ← Back to Activities
            </button>
            <h1 className="text-xl font-semibold">{selectedActivity.name}</h1>
          </div>
          <div className="flex gap-4">
            {phase !== 'init' && (
              <button
                onClick={exportData}
                disabled={isExporting}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {isExporting ? 'Exporting...' : 'Export Data'}
              </button>
            )}
            {phase === 'evaluate' && (
              <button
                onClick={resetCurrentRound}
                disabled={isResettingRound}
                className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {isResettingRound ? 'Resetting...' : 'Reset Current Round'}
              </button>
            )}
            {(phase === 'evaluate' || phase === 'final') && (
              <button
                onClick={resetAllEvaluations}
                disabled={isResettingEvaluations}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {isResettingEvaluations ? 'Resetting...' : 'Reset All Evaluations'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSubmitPhase = () => {
    return (
      <div className="container mx-auto">
        <div className="card">
          <h2 className="text-xl font-bold mb-6">Submission Phase</h2>
          <p className="mb-4">Number of submissions: {submissions.length}</p>
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">Submitted students:</h3>
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
  };

  const renderEvaluatePhase = () => {
    return (
      <div className="container mx-auto">
        <div className="space-y-8">
          <h2 className="text-xl font-bold">Evaluation Phase</h2>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Progress</h3>
            <p className="text-lg mb-2">
              Completed evaluations: {evaluations.length} / {submissions.length}
            </p>
            {submissions.length > 0 && (
              <>
                {pendingEvaluators.length > 0 ? (
                  <p className="text-red-600">
                    Pending: {pendingEvaluators.map(e => e.name).join(', ')}
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

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Current Rankings</h3>
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

          <div className="flex gap-4">
            <button
              onClick={startNextRound}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded shadow"
            >
              Start Next Round
            </button>
            <button
              onClick={endEvaluation}
              className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded shadow"
            >
              End Evaluation
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderFinalPhase = () => {
    return (
      <div className="container mx-auto">
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
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
        Stars Received
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
        <td className="px-6 py-4 whitespace-nowrap">
          {submission.starsReceived} ★
        </td>
      </tr>
    ))}
  </tbody>
</table>
          </div>
        </div>
      </div>
    );
  };

  // Main Render
  if (!selectedActivity) {
    return renderActivityList();
  }

  return (
    <>
      {renderActivityHeader()}
      {phase === 'submit' && renderSubmitPhase()}
      {phase === 'evaluate' && renderEvaluatePhase()}
      {phase === 'final' && renderFinalPhase()}
    </>
  );
}


export default Admin;