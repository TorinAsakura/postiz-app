export interface SocialComment {
  id: string;
  parentId: string | null;
  rootId: string;
  text: string;
  author: { id: string | null; username: string | null; name: string | null };
  timestamp: string | null;
  permalink: string | null;
}

export interface SocialConversation {
  actor: { id: string; username: string | null; name: string | null };
  post: SocialComment;
  comments: SocialComment[];
}

export interface ConversationRequest {
  integrationId: string;
  expectedActorId: string;
  postId: string;
}

export interface ReplyRequest extends ConversationRequest {
  commentId: string;
  message: string;
  requestId: string;
}
