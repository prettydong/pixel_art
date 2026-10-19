/** The user's own text, shown exactly as typed. */
export function UserMessageText({ text }: { text: string }) {
  return <span className="user-message-text">{text}</span>;
}
