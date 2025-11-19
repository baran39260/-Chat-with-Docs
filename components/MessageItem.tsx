/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { Copy, Check, Search } from 'lucide-react';
import { ChatMessage, MessageSender } from '../types';

// --- Constants for Icons ---
const COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`;
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// --- Enhanced Code Block Renderer for `marked` ---

const renderer = new marked.Renderer();

// Update signature to match marked v14+ where code receives an object
// @ts-ignore - ignoring strict type check on the function signature to allow destructuring
renderer.code = function({ text, lang }: { text: string; lang?: string }) {
  const code = text;
  const language = (lang && hljs.getLanguage(lang)) ? lang : 'plaintext';
  const langDisplay = language !== 'plaintext' ? language : '';

  // Highlight the code and split into lines
  const highlighted = hljs.highlight(code, { language }).value;
  const lines = highlighted.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop(); // Remove trailing empty line
  }
  const withLineElements = lines.map(line => `<span class="code-line">${line || '&nbsp;'}</span>`).join('');

  // Store raw code in a hidden textarea for the copy function
  // We escape it to prevent breaking HTML structure
  const escapedCodeForTextarea = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `
    <div class="code-block-wrapper">
        <div class="code-block-header">
            <span class="code-block-lang">${langDisplay}</span>
            <button class="code-copy-btn" title="Copy code">
                ${COPY_ICON_SVG}
            </button>
        </div>
        <pre><code class="hljs language-${language}">${withLineElements}</code></pre>
        <textarea class="code-raw" style="position:absolute;left:-9999px;opacity:0;">${escapedCodeForTextarea}</textarea>
    </div>
  `;
};

// Configure marked to use the custom renderer
marked.setOptions({ renderer });


interface MessageItemProps {
  message: ChatMessage;
}

const SenderAvatar: React.FC<{ sender: MessageSender }> = ({ sender }) => {
  let avatarChar = '';
  let bgColorClass = '';
  let textColorClass = '';

  if (sender === MessageSender.USER) {
    avatarChar = 'U';
    bgColorClass = 'bg-gray-800 dark:bg-white/[.12]';
    textColorClass = 'text-white dark:text-white';
  } else if (sender === MessageSender.MODEL) {
    avatarChar = 'AI';
    bgColorClass = 'bg-gray-200 dark:bg-[#777777]'; 
    textColorClass = 'text-gray-700 dark:text-[#E2E2E2]';
  } else { // SYSTEM
    avatarChar = 'S';
    bgColorClass = 'bg-gray-300 dark:bg-[#4A4A4A]';
    textColorClass = 'text-gray-600 dark:text-[#E2E2E2]';
  }

  return (
    <div className={`w-8 h-8 rounded-full ${bgColorClass} ${textColorClass} flex items-center justify-center text-sm font-semibold flex-shrink-0`}>
      {avatarChar}
    </div>
  );
};

const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const [isCopied, setIsCopied] = useState(false);
  const isUser = message.sender === MessageSender.USER;
  const isModel = message.sender === MessageSender.MODEL;
  const contentRef = useRef<HTMLDivElement>(null);

  // Handle binding events to code block copy buttons
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleCodeCopy = (e: Event) => {
      const button = e.currentTarget as HTMLButtonElement;
      const wrapper = button.closest('.code-block-wrapper');
      if (!wrapper) return;
      
      const textarea = wrapper.querySelector('.code-raw') as HTMLTextAreaElement;
      if (!textarea) return;

      navigator.clipboard.writeText(textarea.value).then(() => {
        button.innerHTML = CHECK_ICON_SVG;
        button.disabled = true;
        setTimeout(() => {
            button.innerHTML = COPY_ICON_SVG;
            button.disabled = false;
        }, 2000);
      }).catch(err => console.error('Failed to copy code:', err));
    };

    const buttons = container.querySelectorAll('.code-copy-btn');
    buttons.forEach(btn => btn.addEventListener('click', handleCodeCopy));

    return () => {
      buttons.forEach(btn => btn.removeEventListener('click', handleCodeCopy));
    };
  }, [message.text]);

  const handleCopy = () => {
    if (isCopied || !message.text) return;
    navigator.clipboard.writeText(message.text)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => {
        console.error('Failed to copy text: ', err);
      });
  };

  const renderMessageContent = () => {
    // Render markdown for both user and model messages to support code blocks, etc.
    if (isUser || isModel) {
      // Use dark:prose-invert for automatic dark mode styling of markdown content
      const proseClasses = "prose prose-sm w-full min-w-0 prose-last:mb-0 dark:prose-invert";
      const rawMarkup = marked.parse(message.text || "") as string;
      return <div ref={contentRef} className={proseClasses} dangerouslySetInnerHTML={{ __html: rawMarkup }} />;
    }

    // Default rendering for system messages
    return <div className="whitespace-pre-wrap text-sm text-gray-500 dark:text-[#A8ABB4]">{message.text}</div>;
  };
  
  const getBubbleClasses = () => {
    let baseClasses = "p-3 rounded-lg shadow w-full flex flex-col gap-2.5 ";
    if (isUser) {
      return baseClasses + "relative group bg-blue-600 text-white dark:bg-white/[.12] rounded-br-none";
    }
    if (isModel) {
      return baseClasses + `relative group bg-gray-200 dark:bg-[rgba(119,119,119,0.10)] text-gray-800 dark:text-[#E2E2E2] border-t border-black/5 dark:border-[rgba(255,255,255,0.04)] backdrop-blur-lg rounded-bl-none`;
    }
    // System message
    return baseClasses + "bg-gray-100 dark:bg-[#2C2C2C] text-gray-500 dark:text-[#A8ABB4] rounded-bl-none";
  };

  return (
    <div className={`flex mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex items-start gap-2 max-w-[85%]`}>
        {!isUser && <SenderAvatar sender={message.sender} />}
        <div className={getBubbleClasses()}>
          {(isUser || isModel) && !message.isLoading && (
            <button
              onClick={handleCopy}
              className="absolute top-1.5 right-1.5 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 text-current/70 hover:text-current hover:bg-black/10 dark:hover:bg-white/10"
              aria-label={isCopied ? "Copied!" : "Copy message to clipboard"}
              title={isCopied ? "Copied!" : "Copy message to clipboard"}
              disabled={isCopied}
            >
              {isCopied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          {message.isLoading ? (
            <div className="flex items-center space-x-1.5 h-6 pl-1">
              <div className={`w-2.5 h-2.5 rounded-full animate-bounce [animation-delay:-0.3s] ${isUser ? 'bg-white' : 'bg-gray-500 dark:bg-[#A8ABB4]'}`}></div>
              <div className={`w-2.5 h-2.5 rounded-full animate-bounce [animation-delay:-0.15s] ${isUser ? 'bg-white' : 'bg-gray-500 dark:bg-[#A8ABB4]'}`}></div>
              <div className={`w-2.5 h-2.5 rounded-full animate-bounce ${isUser ? 'bg-white' : 'bg-gray-500 dark:bg-[#A8ABB4]'}`}></div>
            </div>
          ) : (
            renderMessageContent()
          )}
          
          {/* URL Context Metadata Display */}
          {isModel && message.urlContext && message.urlContext.length > 0 && (
            <div className="pt-2.5 border-t border-black/10 dark:border-[rgba(255,255,255,0.1)]">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-[#A8ABB4] mb-1">Context URLs Retrieved:</h4>
              <ul className="space-y-0.5">
                {message.urlContext.map((meta, index) => {
                  const statusText = typeof meta.urlRetrievalStatus === 'string' 
                    ? meta.urlRetrievalStatus.replace('URL_RETRIEVAL_STATUS_', '') 
                    : 'UNKNOWN';
                  const isSuccess = meta.urlRetrievalStatus === 'URL_RETRIEVAL_STATUS_SUCCESS';

                  return (
                    <li key={index} className="text-[11px] text-gray-500 dark:text-[#A8ABB4]">
                      <a href={meta.retrievedUrl} target="_blank" rel="noopener noreferrer" className="hover:underline break-all text-blue-600 dark:text-[#79B8FF]">
                        {meta.retrievedUrl}
                      </a>
                      <span className={`ml-1.5 px-1 py-0.5 rounded-sm text-[9px] ${
                        isSuccess
                          ? 'bg-gray-300 dark:bg-white/[.12] text-gray-800 dark:text-white'
                          : 'bg-slate-300 dark:bg-slate-600/30 text-slate-600 dark:text-slate-400'
                      }`}>
                        {statusText}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Google Search Grounding Display */}
          {isModel && message.groundingMetadata && message.groundingMetadata.groundingChunks?.length > 0 && (
             <div className="pt-2.5 border-t border-black/10 dark:border-[rgba(255,255,255,0.1)] mt-2">
               <h4 className="text-xs font-semibold text-gray-500 dark:text-[#A8ABB4] mb-1 flex items-center gap-1">
                 <Search size={12} /> Google Search Sources:
               </h4>
               <div className="flex flex-wrap gap-2">
                 {message.groundingMetadata.groundingChunks.map((chunk, idx) => {
                    if (!chunk.web) return null;
                    return (
                      <a 
                        key={idx} 
                        href={chunk.web.uri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[11px] bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-white/5 text-blue-600 dark:text-[#79B8FF] truncate max-w-[200px]"
                        title={chunk.web.title}
                      >
                        {chunk.web.title || chunk.web.uri}
                      </a>
                    );
                 })}
               </div>
             </div>
          )}
        </div>
        {isUser && <SenderAvatar sender={message.sender} />}
      </div>
    </div>
  );
};

export default MessageItem;