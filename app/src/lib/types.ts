export type TurnoutMode = "none" | "voted" | "not_voted" | "both";
export type ResultsMode = "hidden" | "published" | "not_published";

export interface AuthUser {
  id: string;
  code: string;
  name: string;
}

export interface CandidateInfo {
  id: string;
  name: string;
}

export interface PollPublicInfo {
  id: string;
  title: string;
  description: string;
  minChoices: number;
  maxChoices: number;
  shuffleCandidates: boolean;
  deadline: string;
  allowChange: boolean;
  candidates: CandidateInfo[];
  voterCount: number;
  open: boolean;
  resultsMode: ResultsMode;
}

export interface VoterStatus {
  voted: boolean;
  choices: string[];
}

export interface ResultCandidate {
  id: string;
  name: string;
  count: number;
}

export interface TurnoutInfo {
  votedCount: number | null;
  voterTotal: number | null;
  votedNames: string[] | null;
  notVotedNames: string[] | null;
}

export interface ResultsResponse {
  mode: ResultsMode;
  closed: boolean;
  candidates: ResultCandidate[];
  candidateTotal: number;
  turnoutMode: TurnoutMode;
  turnout: TurnoutInfo;
}

export interface AdminCandidate {
  id: string;
  name: string;
  count: number;
}

export interface AdminRosterEntry {
  id: string;
  code: string;
  name: string;
  voted: boolean;
  submittedAt: string | null;
  choiceNames: string[];
}

export interface AdminPoll {
  id: string;
  title: string;
  description: string;
  minChoices: number;
  maxChoices: number;
  shuffleCandidates: boolean;
  anonymous: boolean;
  deadline: string;
  createdAt: string;
  allowChange: boolean;
  autoPublish: boolean;
  pubTopN: number;
  turnoutMode: TurnoutMode;
  published: boolean;
  status: "open" | "closed";
  open: boolean;
  resultsMode: ResultsMode;
}

export interface AdminData {
  poll: AdminPoll;
  candidates: AdminCandidate[];
  roster: AdminRosterEntry[];
  votedCount: number;
  voterTotal: number;
}

export interface MyParticipatingItem {
  id: string;
  title: string;
  deadline: string;
  allowChange: boolean;
  open: boolean;
  resultsMode: ResultsMode;
  voted: boolean;
}

export interface MyParticipatingResponse {
  active: MyParticipatingItem[];
  history: MyParticipatingItem[];
  historyHasMore: boolean;
  historyLimit: number;
}

export interface MyCreatedItem {
  id: string;
  title: string;
  createdAt: string;
  deadline: string;
  open: boolean;
  resultsMode: ResultsMode;
}
