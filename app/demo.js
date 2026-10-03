// Sample posts, made up, so the page can be tried without signing in. They are
// labelled as samples on screen and are never saved.

const HOUR = 3600 * 1000;

export function sample() {
  const now = Date.now();
  const at = (hoursAgo) => new Date(now - hoursAgo * HOUR).toISOString();
  const in_ = (hours) => new Date(now + hours * HOUR).toISOString();
  const science = { id: "demo-science", name: "Science 8 Blue" };
  const english = { id: "demo-english", name: "English 8 Blue" };
  const maths = { id: "demo-maths", name: "Maths 8 Blue" };
  const post = (id, course, kind, title, body, author, posted, dueAt, files = []) => ({
    id: "demo-" + id, courseId: course.id, courseName: course.name, kind, title, body, author,
    link: "", postedAt: posted, updatedAt: posted, dueAt: dueAt || "", files,
  });
  return {
    courses: [science, english, maths],
    posts: [
      post(1, science, "assignment", "Chapter 5 worksheet",
        "Finish questions 1 to 12 on page 45 and upload a photo of your work before the deadline.",
        "Ms. Rahman", at(3), in_(22)),
      post(2, english, "announcement", "Post by Mr. Haddad",
        "Dear students, please read chapter 3 of the novel for tomorrow and bring your notebook. We will discuss the characters in class.",
        "Mr. Haddad", at(5), ""),
      post(3, maths, "announcement", "Post by Mrs. Qureshi",
        "Students solved the exercise on fractions in class today and revised the rules for simplifying. Well done everyone.",
        "Mrs. Qureshi", at(26), ""),
      post(4, science, "material", "Plant cells: revision video",
        "A short video that goes through the parts of a plant cell. Watch it before the quiz.",
        "Ms. Rahman", at(30), "",
        [{ name: "Plant cells in 5 minutes", url: "https://www.youtube.com/watch?v=sample", thumb: "", kind: "video" },
         { name: "Plant cell diagram.pdf", url: "https://drive.google.com/file/d/sample", thumb: "", kind: "pdf" }]),
      post(5, maths, "assignment", "Algebra practice set",
        "Complete the practice set. Show every step of your working.",
        "Mrs. Qureshi", at(50), in_(70)),
      post(6, english, "announcement", "Post by Mr. Haddad",
        "Dear parents, the school will remain closed on Friday for the sports day. Normal timings resume on Monday. Please send your child in the sports uniform.",
        "Mr. Haddad", at(53), ""),
      post(7, science, "announcement", "Post by Ms. Rahman",
        "A quiz on chapters 4 and 5 will be held next Tuesday. Revise your notes.",
        "Ms. Rahman", at(70), ""),
      post(8, english, "material", "Reading list for term 2",
        "Please find the reading list attached for your reference.",
        "Mr. Haddad", at(120), "",
        [{ name: "Term 2 reading list.docx", url: "https://docs.google.com/document/d/sample", thumb: "", kind: "doc" }]),
      post(9, maths, "announcement", "Post by Mrs. Qureshi",
        "Congratulations to our maths club for winning the inter-school quiz!",
        "Mrs. Qureshi", at(200), ""),
      post(10, science, "assignment", "Lab report: acids and bases",
        "Write up the experiment from Tuesday: aim, method, results and conclusion.",
        "Ms. Rahman", at(240), in_(-20)),
    ],
  };
}
