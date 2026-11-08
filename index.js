import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import { jwtVerify, createRemoteJWKSet } from 'jose'
dotenv.config();

const port = process.env.PORT || 5000;
const app = express()

// Adds headers: Access-Control-Allow-Origin: *
app.use(express.json())

app.use(cors({
    origin: ['https://bookstationed.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));


const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}
// Call this only when your application terminates
// export async function disconnectFromMongoDB() {
//   await client.close();
// }
connectToMongoDB()

const db = client.db('bookStore');
const booksCollection = db.collection('bookStore')
const borrowCollection = db.collection('borrows')

// Created ONCE so the signing keys are cached.
// AUTH_URL = where the Next.js app (BetterAuth) runs: http://localhost:3000 locally,
// your deployed frontend URL on Vercel.
const JWKS = createRemoteJWKSet(
    new URL(`${process.env.AUTH_URL || 'http://localhost:3000'}/api/auth/jwks`)
)

const verifyToken = async (req, res, next) => {
    const [, token] = (req.headers.authorization || '').split(' ');
    if (!token) return res.status(401).send({ message: "Unauthorized" });

    try {
        const { payload } = await jwtVerify(token, JWKS)
        req.user = payload;
        next();
    } catch (error) {
        console.error('Token validation failed:', error.message)
        return res.status(401).send({ message: "Unauthorized" });
    }
};

app.get('/books', async (req, res) => {
    const books = await booksCollection.find().sort({ createdAt: -1 }).toArray()
    res.send(books);
});

// Newest 6 books (sorted by createdAt, newest first)
app.get('/books/latest', async (req, res) => {
    const books = await booksCollection.find().sort({ createdAt: -1 }).limit(6).toArray();
    res.send(books);
});

app.get('/categories', async (req, res) => {
    const categories = await booksCollection.distinct('category')
    res.send(categories.sort());
});

// Books added by the logged-in user (must stay ABOVE /books/:id)
app.get('/books/mine', verifyToken, async (req, res) => {
    const books = await booksCollection
        .find({ "addedBy.email": req.user.email })
        .sort({ createdAt: -1 })
        .toArray()
    res.send(books)
})

app.get('/books/:id', async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid book id" })
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).send({ message: "Book not found" })
    res.send(book);
});

app.post('/books', verifyToken, async (req, res) => {
    // Take only the fields we expect. availableCopies and addedBy are set HERE, never by the browser.
    const { title, author, category, image, description, totalCopies } = req.body;
    const email = req.user.email;
    const name = req.user.name;

    const total = Number(totalCopies)
    if (!title || !author || !category || !image || !description) {
        return res.status(400).send({ message: "All fields are required." })
    }
    if (!Number.isInteger(total) || total < 1) {
        return res.status(400).send({ message: "Total copies must be a whole number of 1 or more." })
    }

    // Dot notation: the stored addedBy is { email, name }, so matching the whole object never works
    const alreadyAdded = await booksCollection.findOne({ "addedBy.email": email, title });
    if (alreadyAdded) return res.status(400).send({ message: "You have already added this book." });

    const result = await booksCollection.insertOne({
        title, author, category, image, description,
        totalCopies: total,
        availableCopies: total,
        addedBy: { email, name },
        createdAt: new Date(),
    });
    res.send(result);
});

app.patch('/books/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) { return res.status(400).send({ message: "Invalid book id" }); }
    const book = await booksCollection.findOne({
        _id: new ObjectId(id),
        "addedBy.email": req.user.email,
    })
    if (!book) { return res.status(404).send({ message: "Book not found or not owned by you" }) }

    const { title, author, category, description, image, totalCopies } = req.body
    const changes = {}
    if (title !== undefined) changes.title = title
    if (author !== undefined) changes.author = author
    if (category !== undefined) changes.category = category
    if (description !== undefined) changes.description = description
    if (image !== undefined) changes.image = image

    if (totalCopies !== undefined) {
        const total = Number(totalCopies)
        if (!Number.isInteger(total) || total < 1) {
            return res.status(400).send({ message: "Total copies must be a whole number of 1 or more" })
        }
        const copiesOut = book.totalCopies - book.availableCopies // currently borrowed
        if (total < copiesOut) {
            return res.status(400).send({
                message: `${copiesOut} copies are currently borrowed, so total cannot be below ${copiesOut}`,
            })
        }
        changes.totalCopies = total
        changes.availableCopies = total - copiesOut
    }

    // Matching availableCopies makes sure nobody borrowed or returned in between
    const result = await booksCollection.updateOne(
        { _id: book._id, availableCopies: book.availableCopies },
        { $set: changes }
    )

    if (result.matchedCount === 0) {
        return res.status(409).send({ message: "The book just changed. Please try again." })
    }

    res.send(result);
});

app.delete('/books/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id" })
    }

    const book = await booksCollection.findOne({ _id: new ObjectId(id), "addedBy.email": req.user.email })
    if (!book) return res.status(404).send({ message: "Book not found, or you are not its owner" })

    // Don't delete a book while someone still has a copy
    if (book.availableCopies < book.totalCopies) {
        return res.status(400).send({ message: "This book is currently borrowed and cannot be deleted." })
    }

    const result = await booksCollection.deleteOne({ _id: book._id });
    res.send(result);
});

// ─── Borrows ──────────────────────────────────────────────────────

// The logged-in user's borrows (newest first)
app.get('/borrows', verifyToken, async (req, res) => {
    const borrows = await borrowCollection
        .find({ userEmail: req.user.email })
        .sort({ borrowDate: -1 })
        .toArray()
    res.send(borrows)
});

// Body: { bookId, days }. Dates, title, author and image are set by the server.
app.post('/borrows', verifyToken, async (req, res) => {
    const { bookId, days } = req.body;
    const userEmail = req.user.email;

    if (!ObjectId.isValid(bookId)) return res.status(400).send({ message: "Invalid book id" })
    if (![3, 7, 14].includes(Number(days))) {
        return res.status(400).send({ message: "Days must be 3, 7, or 14." })
    }

    const book = await booksCollection.findOne({ _id: new ObjectId(bookId) })
    if (!book) return res.status(404).send({ message: "Book not found" })

    // Compare by email, not by name or title
    if (book.addedBy?.email === userEmail) {
        return res.status(400).send({ message: "You cannot borrow your own book." });
    }

    const alreadyBorrowed = await borrowCollection.findOne({ userEmail, bookId: String(bookId) });
    if (alreadyBorrowed) return res.status(400).send({ message: "You have already borrowed this book." });

    // 1. Take one copy, only if one is available
    const stock = await booksCollection.updateOne(
        { _id: book._id, availableCopies: { $gt: 0 } },
        { $inc: { availableCopies: -1 } }
    );
    if (stock.modifiedCount === 0) return res.status(400).send({ message: "No available copies to borrow." });

    // 2. Save the borrow. If that fails, give the copy back.
    const borrowDate = new Date()
    const resultDate = new Date()
    resultDate.setDate(resultDate.getDate() + Number(days))

    try {
        const result = await borrowCollection.insertOne({
            bookId: String(bookId),
            title: book.title,
            author: book.author,
            image: book.image,
            userEmail,
            borrowDate,
            resultDate,
        });
        res.send(result);
    } catch (err) {
        await booksCollection.updateOne({ _id: book._id }, { $inc: { availableCopies: 1 } })
        res.status(500).send({ message: "Could not save the borrow." })
    }
});

// Return a book: remove the borrow AND put the copy back on the shelf
app.delete('/borrows/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid borrow id" })
    }

    // Only the borrower can return it
    const borrow = await borrowCollection.findOneAndDelete({
        _id: new ObjectId(id),
        userEmail: req.user.email,
    });
    if (!borrow) return res.status(404).send({ message: "Borrow not found." })

    if (ObjectId.isValid(borrow.bookId)) {
        await booksCollection.updateOne(
            { _id: new ObjectId(borrow.bookId), $expr: { $lt: ["$availableCopies", "$totalCopies"] } },
            { $inc: { availableCopies: 1 } }
        )
    }

    res.send({ message: "Book returned." });
});

// Any unexpected error returns JSON (not an HTML page) so the frontend can show it
app.use((err, req, res, next) => {
    console.error(err)
    res.status(500).send({ message: "Server error. Please try again." })
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});

export default app;