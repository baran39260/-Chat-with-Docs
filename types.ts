/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export enum MessageSender {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system',
}

export interface UrlContextMetadataItem {
  retrievedUrl: string; // Changed from retrieved_url
  urlRetrievalStatus: string; // Changed from url_retrieval_status
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface GroundingMetadata {
  groundingChunks: GroundingChunk[];
  groundingSupports?: any[];
  webSearchQueries?: string[];
  searchEntryPoint?: {
    renderedContent: string;
  };
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: MessageSender;
  timestamp: Date;
  isLoading?: boolean;
  urlContext?: UrlContextMetadataItem[];
  groundingMetadata?: GroundingMetadata;
}

export type KnowledgeItem =
  | { type: 'url'; value: string }
  | { type: 'file'; name: string; content: string; mimeType: string };


export interface KnowledgeGroup {
  id: string;
  name: string;
  items: KnowledgeItem[];
}