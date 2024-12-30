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

  // Change to use student emails instead of doc IDs
  studentIds = submissionsSnapshot.docs.map((doc) => doc.data().studentEmail);
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
      if (!currentRoundTriads.some(triad => triad.has(sortedStudentIds[i]))) {
        for (let j = i + 1; j < sortedStudentIds.length; j++) {
          if (!currentRoundTriads.some(triad => triad.has(sortedStudentIds[j])) &&
            !pairingsSoFar.some(pair => areSetsEqual(pair, new Set([sortedStudentIds[i], sortedStudentIds[j]])))) {
            for (let k = j + 1; k < sortedStudentIds.length; k++) {
              if (!currentRoundTriads.some(triad => triad.has(sortedStudentIds[k])) &&
                !pairingsSoFar.some(pair => areSetsEqual(pair, new Set([sortedStudentIds[i], sortedStudentIds[k]]))) &&
                !pairingsSoFar.some(pair => areSetsEqual(pair, new Set([sortedStudentIds[j], sortedStudentIds[k]])))) {
                currentRoundTriads.push(new Set([sortedStudentIds[i], sortedStudentIds[j], sortedStudentIds[k]]));
                break;
              }
            }
            if (currentRoundTriads.length > 0 && currentRoundTriads[currentRoundTriads.length - 1].has(sortedStudentIds[i])) {
              break;
            }
          }
        }
      }
    }
  
    const missingPapers = sortedStudentIds.filter(id => !currentRoundTriads.some(triad => triad.has(id)));
    if (missingPapers.length > 0 && currentRoundTriads.length > 0) {
      missingPapers.forEach(id => currentRoundTriads[currentRoundTriads.length - 1].add(id));
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
      } else if (groupArray.length > 3) {
        let foundValidPairing = false;
        let numberOfAttempts = 0;
        while (!foundValidPairing && numberOfAttempts < 1000) {
          numberOfAttempts++;
          const shuffledGroup = [...groupArray].sort(() => Math.random() - 0.5);
          const tentativePairings = [];
          for (let i = 0; i < shuffledGroup.length; i++) {
            tentativePairings.push(
              new Set([shuffledGroup[i], shuffledGroup[(i + 1) % shuffledGroup.length]])
            );
          }
          
          if (tentativePairings.every(pair => 
            !pairingsSoFar.some(existingPair => areSetsEqual(pair, existingPair))
          )) {
            currentRoundPairings.push(...tentativePairings);
            foundValidPairing = true;
          }
        }
      }
    }
    
    pairingsSoFar.push(...currentRoundPairings.map(pair => new Set(pair)));
    console.log('Created pairings:', currentRoundPairings);
    return currentRoundPairings;
  };

// Helper function to compare sets
const areSetsEqual = (set1, set2) => {
  if (set1.size !== set2.size) return false;
  for (let item of set1) {
    if (!set2.has(item)) return false;
  }
  return true;
};

// Function to assign evaluators
const assignEvaluators = (pairings) => {
    const currentRoundEvaluatorAssigned = {};
    let allMatched = false;
    let attempts = 0;
  
    while (!allMatched && attempts < 1000) {
      attempts++;
      const shuffledStudentIds = [...studentIds].sort(() => Math.random() - 0.5);
      const evaluators = shuffledStudentIds.sort((a, b) => scores[a] - scores[b]);
      let tempEvaluatorAssignments = {};
      let assignedPairs = new Set();
  
      for (const evaluator of evaluators) {
        for (const pair of pairings) {
          const [x, y] = [...pair];
          
          const pairAlreadyAssigned = Array.from(assignedPairs).some(p => areSetsEqual(p, pair));
          const evaluatorAlreadyAssigned = tempEvaluatorAssignments.hasOwnProperty(evaluator);
          const evaluatorIsAParticipant = pair.has(evaluator);
          const evaluatorHasSeenX = evaluatedPapersByStudent[evaluator].includes(x);
          const evaluatorHasSeenY = evaluatedPapersByStudent[evaluator].includes(y);
          
          if (!pairAlreadyAssigned && !evaluatorAlreadyAssigned && !evaluatorIsAParticipant && !evaluatorHasSeenX && !evaluatorHasSeenY) {
            tempEvaluatorAssignments[evaluator] = pair;
            assignedPairs.add(pair);
            break;
          }
        }
      }
  
      if (Object.keys(tempEvaluatorAssignments).length === studentIds.length) {
        allMatched = true;
        Object.assign(currentRoundEvaluatorAssigned, tempEvaluatorAssignments);
        for (const evaluator in currentRoundEvaluatorAssigned) {
          evaluatedPapersByStudent[evaluator].push(...currentRoundEvaluatorAssigned[evaluator]);
        }
      }
    }
    
    if (!allMatched) {
      console.warn(`Failed to assign all evaluators after ${attempts} attempts.`);
    }
  
    return currentRoundEvaluatorAssigned;
  };
  

export const resetEvaluationManager = () => {
  studentIds = [];
  scores = {};
  pairingsSoFar = [];
  evaluatedPapersByStudent = {};
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
  
  // Convert Sets to Arrays for Firebase storage
  const evaluatorsArrays = {};
  Object.entries(evaluators).forEach(([email, pairSet]) => {
    evaluatorsArrays[email] = Array.from(pairSet);
  });
  
  console.log('Assigned evaluators:', evaluatorsArrays);
  return evaluatorsArrays;
};