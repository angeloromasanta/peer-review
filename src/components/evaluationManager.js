import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

// Initialize for entire activity
let studentIds = [];
let scores = {};
let pairingsSoFar = [];
let evaluatedPapersByStudent = {};

// Function to initialize the evaluation manager
export const initializeEvaluationManager = async (activityId) => {
  const submissionsSnapshot = await getDocs(
    query(collection(db, 'submissions'), where('activityId', '==', activityId))
  );

  studentIds = submissionsSnapshot.docs.map((doc) => doc.id);
  scores = Object.fromEntries(studentIds.map((id) => [id, 0]));
  evaluatedPapersByStudent = Object.fromEntries(
    studentIds.map((id) => [id, []])
  );
  pairingsSoFar = [];
};

// Function to create triads
const createTriads = () => {
  const currentRoundTriads = [];
  const shuffledStudentIds = [...studentIds].sort(() => Math.random() - 0.5);
  const sortedStudentIds = shuffledStudentIds.sort((a, b) => scores[b] - scores[a]);

  for (let i = 0; i < sortedStudentIds.length; i++) {
    if (currentRoundTriads.every(triad => !triad.has(sortedStudentIds[i]))) {
      for (let j = i + 1; j < sortedStudentIds.length; j++) {
        if (currentRoundTriads.every(triad => !triad.has(sortedStudentIds[j])) && 
            !pairingsSoFar.some(pair => pair.has(sortedStudentIds[i]) && pair.has(sortedStudentIds[j]))) {
          for (let k = j + 1; k < sortedStudentIds.length; k++) {
            if (currentRoundTriads.every(triad => !triad.has(sortedStudentIds[k])) &&
                !pairingsSoFar.some(pair => pair.has(sortedStudentIds[i]) && pair.has(sortedStudentIds[k])) &&
                !pairingsSoFar.some(pair => pair.has(sortedStudentIds[j]) && pair.has(sortedStudentIds[k]))) {
              currentRoundTriads.push(new Set([sortedStudentIds[i], sortedStudentIds[j], sortedStudentIds[k]]));
              break;
            }
          }
          if (currentRoundTriads[currentRoundTriads.length - 1]?.has(sortedStudentIds[i])) break;
        }
      }
    }
  }

  // Handle missing papers
  const missingPapers = sortedStudentIds.filter(
    id => !currentRoundTriads.some(triad => triad.has(id))
  );
  if (missingPapers.length > 0 && currentRoundTriads.length > 0) {
    const lastTriad = currentRoundTriads[currentRoundTriads.length - 1];
    missingPapers.forEach(id => lastTriad.add(id));
  }

  console.log('Created triads:', currentRoundTriads);
  return currentRoundTriads;
};

// Function to create pairings from triads
const createPairings = (triads) => {
  const currentRoundPairings = [];
  for (const group of triads) {
    const groupArray = Array.from(group);
    if (groupArray.length === 3) {
      currentRoundPairings.push(
        new Set([groupArray[0], groupArray[1]]),
        new Set([groupArray[0], groupArray[2]]),
        new Set([groupArray[1], groupArray[2]])
      );
    } else {
      let foundValidPairing = false;
      let numberOfAttempts = 0;
      while (!foundValidPairing && numberOfAttempts < 1000) {
        const shuffledGroup = [...groupArray].sort(() => Math.random() - 0.5);
        const tentativePairings = [];
        for (let i = 0; i < shuffledGroup.length; i++) {
          tentativePairings.push(
            new Set([shuffledGroup[i], shuffledGroup[(i + 1) % shuffledGroup.length]])
          );
        }
        if (tentativePairings.every(pair => 
          !pairingsSoFar.some(existingPair => 
            areSetsEqual(pair, existingPair)
          ))) {
          currentRoundPairings.push(...tentativePairings);
          foundValidPairing = true;
        }
        numberOfAttempts++;
      }
    }
  }
  
  pairingsSoFar.push(...currentRoundPairings);
  console.log('Created pairings:', currentRoundPairings);
  return currentRoundPairings;
};

// Helper function to compare sets
const areSetsEqual = (set1, set2) => {
  if (set1.size !== set2.size) return false;
  return Array.from(set1).every(item => set2.has(item));
};

// Function to assign evaluators
const assignEvaluators = (pairings) => {
  const currentRoundEvaluatorAssigned = {};
  let allMatched = false;
  let numberOfAttempts = 0;
  let tentativeEvaluators = {}; // Declare outside the loop

  while (!allMatched && numberOfAttempts < 1000) {
    tentativeEvaluators = {}; // Reset for each attempt
    const shuffledStudentIds = [...studentIds].sort(() => Math.random() - 0.5);
    const evaluators = shuffledStudentIds.sort((a, b) => scores[a] - scores[b]);

    for (const evaluator of evaluators) {
      for (const pair of pairings) {
        const [x, y] = [...pair];
        if (
          !currentRoundEvaluatorAssigned[evaluator] &&
          !pair.has(evaluator) &&
          !Object.values(currentRoundEvaluatorAssigned).some((p) => p === pair) &&
          !evaluatedPapersByStudent[evaluator].includes(x) &&
          !evaluatedPapersByStudent[evaluator].includes(y)
        ) {
          tentativeEvaluators[evaluator] = pair;
        }
      }
    }
    allMatched = Object.keys(tentativeEvaluators).length === studentIds.length;
    numberOfAttempts++;
  }

  for (const [evaluator, pair] of Object.entries(tentativeEvaluators)) {
    currentRoundEvaluatorAssigned[evaluator] = pair;
    evaluatedPapersByStudent[evaluator].push(...pair);
  }

  return currentRoundEvaluatorAssigned;
};

// Function to run the evaluation round
export const runEvaluationRound = async (activityId) => {
  console.log('Starting evaluation round for activity:', activityId);
  
  await initializeEvaluationManager(activityId);
  console.log('Initialized with students:', studentIds);
  
  const triads = createTriads();
  console.log('Created triads:', triads);
  
  const pairings = createPairings(triads);
  console.log('Created pairings:', pairings);
  
  const evaluators = assignEvaluators(pairings);
  console.log('Assigned evaluators:', evaluators);
  
  // Map student IDs to emails for the return value
  const submissionsSnapshot = await getDocs(
    query(collection(db, 'submissions'), where('activityId', '==', activityId))
  );
  
  const idToEmailMap = {};
  submissionsSnapshot.docs.forEach(doc => {
    idToEmailMap[doc.id] = doc.data().studentEmail;
  });
  
  // Convert the evaluator assignments to use emails instead of IDs
  const evaluatorsByEmail = {};
  for (const [evaluatorId, pair] of Object.entries(evaluators)) {
    const evaluatorEmail = idToEmailMap[evaluatorId];
    if (evaluatorEmail) {
      evaluatorsByEmail[evaluatorEmail] = Array.from(pair);
    }
  }
  
  return evaluatorsByEmail;
};




