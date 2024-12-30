// simulationTest.js
import { collection, addDoc, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { runEvaluationRound } from './evaluationManager';

export const runSimulation = async () => {
    const results = {
        rounds: []
    };

    try {
        // Create test activity
        const activityRef = await addDoc(collection(db, 'activities'), {
            name: 'Simulation Test',
            phase: 'submit',
            currentRound: 0,
        });
        
        // Create email to submission mapping
        const submissionsByEmail = {};
        
        // Create 10 simulated submissions
        for (let i = 1; i <= 10; i++) {
            const studentEmail = `student${i}@test.com`;
            const submissionDoc = await addDoc(collection(db, 'submissions'), {
                activityId: activityRef.id,
                studentName: `Student ${i}`,
                studentEmail: studentEmail,
                studentId: i,
                content: `Test submission from student ${i}`,
                timestamp: new Date(),
            });
            
            submissionsByEmail[studentEmail] = {
                id: submissionDoc.id,
                studentId: i,
                studentEmail
            };
        }

        // Run 5 rounds
        for (let round = 1; round <= 5; round++) {
            console.log(`\n=== Starting Round ${round} ===`);
            
            // Run evaluation round
            const evaluatorAssignments = await runEvaluationRound(activityRef.id);
            
            // Update activity with new round
            await updateDoc(doc(db, 'activities', activityRef.id), {
                phase: 'evaluate',
                currentRound: round,
                evaluatorAssignments
            });

            // Simulate evaluations based on student ID (lower ID wins)
            const roundEvaluations = [];
            
            for (const [evaluatorEmail, pairEmails] of Object.entries(evaluatorAssignments)) {
                const [email1, email2] = pairEmails;
                const sub1 = submissionsByEmail[email1];
                const sub2 = submissionsByEmail[email2];
                
                if (!sub1 || !sub2) {
                    console.error('Missing submission for emails:', email1, email2);
                    continue;
                }

                const winner = sub1.studentId < sub2.studentId ? sub1.id : sub2.id;
                
                const evaluation = await addDoc(collection(db, 'evaluations'), {
                    activityId: activityRef.id,
                    round,
                    evaluatorEmail,
                    leftSubmissionId: sub1.id,
                    rightSubmissionId: sub2.id,
                    winner,
                    timestamp: new Date()
                });
                
                roundEvaluations.push({
                    evaluator: evaluatorEmail,
                    pair: [email1, email2],
                    winner: sub1.studentId < sub2.studentId ? sub1.studentId : sub2.studentId
                });
            }

            // Calculate scores for this round
            const scores = {};
            const evaluationsSnapshot = await getDocs(
                query(collection(db, 'evaluations'), 
                    where('activityId', '==', activityRef.id))
            );
            
            evaluationsSnapshot.docs.forEach(doc => {
                const data = doc.data();
                scores[data.winner] = (scores[data.winner] || 0) + 1;
            });

            // Store round results
            results.rounds.push({
                round,
                evaluations: roundEvaluations,
                scores: Object.entries(scores)
                    .map(([subId, score]) => {
                        const submission = Object.values(submissionsByEmail)
                            .find(s => s.id === subId);
                        return {
                            studentId: submission.studentId,
                            score
                        };
                    })
                    .sort((a, b) => b.score - a.score)
            });

            // Debug output for this round
            console.log('\nRound Stats:');
            console.log('Number of evaluations:', roundEvaluations.length);
            console.log('Unique evaluators:', new Set(roundEvaluations.map(e => e.evaluator)).size);
            console.log('Unique pairs:', new Set(roundEvaluations.map(e => e.pair.sort().join('-'))).size);
        }

        return results;
    } catch (error) {
        console.error('Simulation error:', error);
        throw error;
    }
};