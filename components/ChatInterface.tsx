/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, MessageSender } from '../types'; 
import MessageItem from './MessageItem';
import { Send, Menu } from 'lucide-react';
import ThemeSwitcher from './ThemeSwitcher';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (query: string) => void;
  isLoading: boolean;
  placeholderText?: string;
  initialQuerySuggestions?: string[];
  onSuggestedQueryClick?: (query: string) => void;
  isFetchingSuggestions?: boolean;
  onToggleSidebar?: () => void;
  inputDisabled?: boolean;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  messages, 
  onSendMessage, 
  isLoading, 
  placeholderText,
  initialQuerySuggestions,
  onSuggestedQueryClick,
  isFetchingSuggestions,
  onToggleSidebar,
  inputDisabled = false,
}) => {
  const [userQuery, setUserQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Scroll when messages change or when suggestion UI state changes
  useEffect(scrollToBottom, [messages, isFetchingSuggestions, initialQuerySuggestions]);

  // Global keyboard shortcut (Cmd+K or Ctrl+K) to focus input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Prevent default browser behavior (like search bar focus in some browsers)
        e.preventDefault();
        // Only focus if input is not disabled
        if (!inputDisabled && !isLoading) {
          textareaRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputDisabled, isLoading]);

  const handleSend = () => {
    if (userQuery.trim() && !isLoading && !inputDisabled) {
      onSendMessage(userQuery.trim());
      setUserQuery('');
    }
  };

  // Check if there are any user messages to determine if we are in the "initial" state
  const hasUserMessages = messages.some(m => m.sender === MessageSender.USER);
  const showSuggestions = initialQuerySuggestions && initialQuerySuggestions.length > 0 && !hasUserMessages && !inputDisabled;

  const getPlaceholder = () => {
    if (inputDisabled) return "Configuration required (see above)";
    if (isLoading) return "AI is thinking...";
    if (isFetchingSuggestions) return "Loading suggestions...";
    return placeholderText || "Ask about the documents...";
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1E1E1E] rounded-xl shadow-md border border-gray-200 dark:border-[rgba(255,255,255,0.05)]">
      <div className="p-4 border-b border-gray-200 dark:border-[rgba(255,255,255,0.05)] flex justify-between items-center">
        <div className="flex items-center gap-3">
           {onToggleSidebar && (
            <button 
              onClick={onToggleSidebar}
              className="p-1.5 text-gray-500 dark:text-[#A8ABB4] hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-200 dark:hover:bg-white/10 transition-colors md:hidden"
              aria-label="Open knowledge base"
            >
              <Menu size={20} />
            </button>
          )}
          <div>
            <h2 className="text-xl font-semibold text-gray-800 dark:text-[#E2E2E2]">Documentation Browser</h2>
            {placeholderText && !hasUserMessages && (
               <p className="text-xs text-gray-500 dark:text-[#A8ABB4] mt-1 max-w-md truncate" title={placeholderText}>{placeholderText}</p>
            )}
          </div>
        </div>
        <ThemeSwitcher />
      </div>

      <div className="flex-grow p-4 overflow-y-auto chat-container bg-gray-100 dark:bg-[#282828]">
        {/* New wrapper for max-width and centering */}
        <div className="max-w-4xl mx-auto w-full">
          {messages.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}
          
          {isFetchingSuggestions && !hasUserMessages && (
             <div className="my-3 px-1 animate-in fade-in duration-500">
                <p className="text-xs text-gray-400 dark:text-gray-600 mb-2 font-medium animate-pulse">Generating suggestions...</p>
                <div className="flex flex-wrap gap-2">
                   <div className="h-7 w-32 bg-gray-200 dark:bg-white/5 rounded-full animate-pulse"></div>
                   <div className="h-7 w-24 bg-gray-200 dark:bg-white/5 rounded-full animate-pulse"></div>
                   <div className="h-7 w-40 bg-gray-200 dark:bg-white/5 rounded-full animate-pulse"></div>
                   <div className="h-7 w-28 bg-gray-200 dark:bg-white/5 rounded-full animate-pulse delay-75"></div>
                </div>
             </div>
          )}

          {showSuggestions && onSuggestedQueryClick && (
            <div className="my-3 px-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-xs text-gray-500 dark:text-[#A8ABB4] mb-1.5 font-medium">Or try one of these: </p>
              <div className="flex flex-wrap gap-1.5">
                {initialQuerySuggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => onSuggestedQueryClick(suggestion)}
                    className="bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full text-xs hover:bg-blue-200 transition-colors shadow-sm dark:bg-[#79B8FF]/10 dark:text-[#79B8FF] dark:hover:bg-[#79B8FF]/20"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-[rgba(255,255,255,0.05)] bg-white dark:bg-[#1E1E1E] rounded-b-xl">
        <div className="flex items-center gap-2">
          <textarea
            ref={textareaRef}
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder={getPlaceholder()}
            className="flex-grow h-8 min-h-[32px] py-1.5 px-2.5 border border-gray-300 dark:border-[rgba(255,255,255,0.1)] bg-gray-50 dark:bg-[#2C2C2C] text-gray-800 dark:text-[#E2E2E2] placeholder-gray-400 dark:placeholder-[#777777] rounded-lg focus:ring-1 focus:ring-blue-500 dark:focus:ring-white/20 focus:border-blue-500 dark:focus:border-white/20 transition-shadow resize-none text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            rows={1}
            disabled={isLoading || inputDisabled}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !userQuery.trim() || inputDisabled}
            className="h-8 w-8 p-1.5 bg-gray-800 hover:bg-gray-900 text-white dark:bg-white/[.12] dark:hover:bg-white/20 dark:text-white rounded-lg transition-colors disabled:bg-gray-300 dark:disabled:bg-[#4A4A4A] disabled:text-gray-500 dark:disabled:text-[#777777] flex items-center justify-center flex-shrink-0"
            aria-label="Send message"
          >
            {(isLoading && messages[messages.length-1]?.isLoading && messages[messages.length-1]?.sender === MessageSender.MODEL) ? 
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div> 
              : <Send size={16} />
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
