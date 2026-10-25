export type TurnoutMode = "none" | "voted" | "not_voted" | "both";
export type ResultsMode = "hidden" | "published" | "not_published";

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
  voterNames: string[];
  voterCount: number;
  open: boolean;
  resultsMode: ResultsMode;
}

export interface VoterStatus {
  exists: boolean;
  needsPasscode: boolean;
  passcodeOk: boolean;
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
  name: string;
  passcode: string;
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

export interface CreatePollResponse {
  id: string;
  adminToken: string;
}

export interface RecentPoll {
  id: string;
  title: string;
  adminToken: string;
  createdAt: number;
}
