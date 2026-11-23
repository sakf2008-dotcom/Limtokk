/**
 * Public data shapes shared by the API, the server components and the client components.
 * These are what leaves the server, so they must never contain secrets or device identifiers.
 */

export type VideoStatus =
  | "pending_upload"
  | "pending_review"
  | "approved"
  | "rejected"
  | "hidden"
  | "expired"
  | "deleted";

export interface CategoryDto {
  id: string;
  nameAr: string;
  descriptionAr: string;
  accent: string;
  icon: string;
  sortOrder: number;
}

export interface CreatorDto {
  id: string;
  name: string;
  avatar: string;
}

export interface VideoCardDto {
  id: string;
  title: string;
  description: string;
  keyFact: string | null;
  hashtags: string[];
  categoryId: string;
  categoryName: string;
  categoryAccent: string;
  creator: CreatorDto;
  mediaUrl: string;
  posterUrl: string | null;
  durationMs: number;
  width: number | null;
  height: number | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  quizCount: number;
  liked: boolean;
  isDemo: boolean;
  isFeatured: boolean;
  publishedAt: string | null;
}

export interface CommentDto {
  id: string;
  parentId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  replies: CommentDto[];
}

export interface PlaylistSummaryDto {
  slug: string;
  titleAr: string;
  descriptionAr: string;
  videoCount: number;
}

export interface QuizDto {
  id: string;
  videoId: string;
  question: string;
  options: string[];
}

export interface PlatformInfoDto {
  demoMode: boolean;
  storageAvailable: boolean;
  uploadMaxBytes: number;
  maxDurationSeconds: number;
  minDurationSeconds: number;
  commentsEnabled: boolean;
}
