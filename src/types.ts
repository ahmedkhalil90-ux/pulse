export type UserDemographics = {
  ageRange?: string;
  gender?: string;
  country?: string;
};

export type UserProfile = {
  uid: string;
  username: string;
  isVerified: boolean;
  credits: number;
  demographics: UserDemographics;
  lastLogin: string;
  referralCode?: string;
  referredBy?: string;
};

export type QuestionStatus = 'pending' | 'live' | 'rejected';

export type Question = {
  id: string;
  text: string;
  options: [string, string];
  category: string;
  authorUid: string;
  isPublic: boolean;
  groupId?: string;
  createdAt: string;
  status: QuestionStatus;
  rejectionReason?: string;
  flags: number;
  random: number;
  boostCount?: number;
};

export type UserAnswer = {
  id: string;
  userId: string;
  questionId: string;
  answerIndex: number;
  answeredAt: string;
  option0PercentAtTime: number;
  option1PercentAtTime: number;
  isRevisit?: boolean;
};

export type ResultCounts = {
  [key: string]: number; // '0' or '1'
};

export type DemographicResult = {
  [group: string]: {
    [value: string]: ResultCounts;
  };
};

export type QuestionResult = {
  id: string;
  counts: ResultCounts;
  demographics: DemographicResult;
};

export type Group = {
  id: string;
  name: string;
  description?: string;
  inviteCode: string;
  adminUid: string;
  members: string[];
};

export type GameStatus = 'lobby' | 'active' | 'finished';
export type GameType = 'live' | 'async';

export type Game = {
  id: string;
  type: GameType;
  status: GameStatus;
  hostUid: string;
  players: string[];
  questions: string[]; // Question IDs
  currentQuestionIndex: number;
  deadline?: string;
  scores: Record<string, number>; // playerUid -> points
  predictions: Record<string, Record<string, number>>; // playerUid -> questionId -> optionIndex
  answers: Record<string, Record<string, number>>; // playerUid -> questionId -> optionIndex
  playerQuestions: Record<string, string[]>; // playerUid -> questionIds
  inviteCode: string;
  questionsPerPlayer: number;
  createdAt: string;
};

export type GameQuestion = {
  id: string;
  gameId: string;
  authorUid: string;
  authorUsername: string;
  text: string;
  options: [string, string];
  createdAt: string;
};
