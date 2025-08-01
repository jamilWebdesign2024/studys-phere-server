const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

app.use(cookieParser());



const verifyToken = (req, res, next) => {
  try {
    const token = req?.cookies?.token;
    // console.log('Token in middleware:', token);
    console.log(token);

    if (!token) {
      return res.status(401).send({ message: 'Unauthorized Access: No token' });
    }

    jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).send({ message: 'Forbidden: Invalid token' });
      }

      req.decoded = decoded; // e.g., { email, role }
      // console.log(decoded);
      next();
    });
  } catch (err) {
    console.error('Token verification error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};


const verifyRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
      const email = req.decoded?.email;
      console.log(roles);

      if (!email) {
        return res.status(401).send({ message: 'Unauthorized: Missing email in token' });
      }

      const db = client.db('studysphere');
      const usersCollection = db.collection('users');

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      if (!roles.includes(user.role)) {
        return res.status(403).send({ message: 'Access Denied: Role restricted' });
      }

      next();
    } catch (error) {
      console.error('Role check error:', error);
      return res.status(500).send({ message: 'Internal Server Error' });
    }
  };
};





// Mongodb process


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.1gwegko.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("studysphere").collection("users");
    const sessionsCollection = client.db("studysphere").collection("sessions");
    const reviewsCollection = client.db("studysphere").collection("reviews");
    const bookedSessionCollection = client
      .db("studysphere")
      .collection("bookedSession");
    const notesCollection = client.db("studysphere").collection("notes");
    const materialsCollection = client
      .db("studysphere")
      .collection("materials");



    // Stripe post for intent
    // for payment confirmation from stripe
    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents, // Stripe works in cents
        currency: "usd", // or 'bdt' if applicable for test
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });




    //****************************************/
    //*****    JWT token Related Api     *****/
    //****************************************/
    app.post('/jwt', async (req, res) => {
      const userData = req.body;
      const token = jwt.sign(userData, process.env.JWT_ACCESS_SECRET, { expiresIn: '1d' })

      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })

    })


    app.post("/logout", (req, res) => {
      // res.clearCookie("token");
      // res.json({ message: "Logged out" });
      res
        .clearCookie('token', {
          maxAge: 0,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })


    });
    





    // step 1: users data receive
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };

      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User already exists", inserted: false });
      }

      const result = await usersCollection.insertOne(user);
      res.send({ message: "User created", inserted: true, result });
    });



    //******    Dashboard ******* */

    // toturo dashbord
    app.get('/dashboard/tutor-overview', verifyToken, verifyRole('tutor'), async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).json({ message: 'Tutor email is required' });
        }

        // Sessions created by the tutor
        const sessions = await sessionsCollection.find({ tutorEmail: email }).toArray();
        const totalSessions = sessions.length;

        // Booked sessions for the tutor
        const bookedSessions = await bookedSessionCollection.find({ tutorEmail: email }).toArray();
        const totalBookings = bookedSessions.length;

        // Calculate total revenue
        const totalRevenue = bookedSessions.reduce((acc, item) => acc + parseFloat(item.registrationFee || 0), 0);

        // Reviews for sessions created by the tutor
        const sessionIds = sessions.map(session => session._id.toString());
        const reviews = await reviewsCollection.find({ sessionId: { $in: sessionIds } }).toArray();
        const totalReviews = reviews.length;

        // Calculate average rating
        const averageRating = totalReviews > 0
          ? (reviews.reduce((acc, item) => acc + item.rating, 0) / totalReviews).toFixed(1)
          : 0;

        // Session booking count by sessionTitle (for chart)
        const sessionBookingCount = {};
        bookedSessions.forEach((booking) => {
          const title = booking.sessionTitle || 'Untitled';
          sessionBookingCount[title] = (sessionBookingCount[title] || 0) + 1;
        });

        res.json({
          totalSessions,
          totalBookings,
          totalRevenue,
          totalReviews,
          averageRating,
          sessionBookingCount
        });
      } catch (err) {
        console.error('Error fetching tutor dashboard:', err);
        res.status(500).json({ message: 'Failed to fetch tutor dashboard' });
      }
    });


    // admin dashboard

    // Assuming MongoDB native driver and Express.js

    app.get('/dashboard/admin-overview', verifyToken, verifyRole('admin'), async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalTutors = await usersCollection.countDocuments({ role: "tutor" });
        const totalSessions = await sessionsCollection.countDocuments();
        const totalBookings = await bookedSessionCollection.countDocuments();
        const totalReviews = await reviewsCollection.countDocuments();
        const totalNotes = await notesCollection.countDocuments();
        const totalMaterials = await materialsCollection.countDocuments();

        const totalRevenueAggregation = await bookedSessionCollection.aggregate([
          { $group: { _id: null, totalRevenue: { $sum: "$registrationFee" } } }
        ]).toArray();

        const totalRevenue = totalRevenueAggregation[0]?.totalRevenue || 0;

        const averageRatingAggregation = await reviewsCollection.aggregate([
          { $group: { _id: null, avgRating: { $avg: "$rating" } } }
        ]).toArray();

        const averageRating = averageRatingAggregation[0]?.avgRating?.toFixed(1) || "0";

        // Aggregate bookings count by sessionTitle
        const sessionBookingCountArray = await bookedSessionCollection.aggregate([
          {
            $group: {
              _id: "$sessionTitle",
              count: { $sum: 1 },
            },
          },
        ]).toArray();

        // Convert array to object { sessionTitle: count }
        const sessionBookingCount = {};
        sessionBookingCountArray.forEach(({ _id, count }) => {
          sessionBookingCount[_id] = count;
        });

        res.json({
          totalUsers,
          totalTutors,
          totalSessions,
          totalBookings,
          totalReviews,
          totalNotes,
          totalMaterials,
          totalRevenue,
          averageRating,
          sessionBookingCount,  // <--- IMPORTANT, add this
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
      }
    });




    // ✅ BACKEND: Get student dashboard overview
    // Endpoint: GET /dashboard/student-overview?email=student@gmail.com

    app.get('/dashboard/student-overview', verifyToken, verifyRole('student'), async (req, res) => {
      try {
        const studentEmail = req.query.email;
        if (!studentEmail) return res.status(400).json({ error: 'Student email is required' });

        const [bookedSessions, reviews, notes, materials] = await Promise.all([
          bookedSessionCollection.find({ studentEmail }).toArray(),
          reviewsCollection.find({ studentEmail }).toArray(),
          notesCollection.find({ email: studentEmail }).toArray(),
          materialsCollection.find({ uploadedBy: studentEmail }).toArray() // optional condition
        ]);

        // Optional: session titles for bar/pie chart
        const sessionBookingCount = {};
        bookedSessions.forEach((session) => {
          sessionBookingCount[session.sessionTitle] = (sessionBookingCount[session.sessionTitle] || 0) + 1;
        });

        const totalSpent = bookedSessions.reduce((sum, b) => sum + parseFloat(b.registrationFee || 0), 0);

        const averageRating =
          reviews.length > 0
            ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
            : 0;

        res.json({
          totalBookedSessions: bookedSessions.length,
          totalReviews: reviews.length,
          totalNotes: notes.length,
          totalMaterials: materials.length,
          totalSpent,
          averageRating,
          sessionBookingCount,
        });
      } catch (err) {
        console.error('Student Dashboard Error:', err);
        res.status(500).json({ error: 'Server Error' });
      }
    });



    //// admin profile
    app.get('/api/admin/profile', verifyToken, verifyRole('admin'), async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await usersCollection.findOne({ email, role: 'admin' }, { projection: { password: 0 } });
        if (!user) return res.status(404).json({ error: 'Admin not found' });

        res.json(user);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // for update admin profile
    // Expect JSON body: { email, name, photo }
    // Email required to identify user
    app.put('/api/admin/profile', verifyToken, verifyRole('admin'), async (req, res) => {
      try {
        const { email, name, photo } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const updateDoc = {};
        if (name) updateDoc.name = name;
        if (photo) updateDoc.photo = photo;

        const result = await usersCollection.updateOne({ email, role: 'admin' }, { $set: updateDoc });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Admin not found' });

        const updatedUser = await usersCollection.findOne({ email }, { projection: { password: 0 } });
        res.json(updatedUser);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
      }
    });



    //// student profile
    app.get('/api/student/profile', verifyToken, verifyRole('student'), async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await usersCollection.findOne({ email, role: 'student' }, { projection: { password: 0 } });
        if (!user) return res.status(404).json({ error: 'student not found' });

        res.json(user);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // for update student profile
    // Expect JSON body: { email, name, photo }
    // Email required to identify user
    app.put('/api/student/profile', verifyToken, verifyRole('student'), async (req, res) => {
      try {
        const { email, name, photo } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const updateDoc = {};
        if (name) updateDoc.name = name;
        if (photo) updateDoc.photo = photo;

        const result = await usersCollection.updateOne({ email, role: 'student' }, { $set: updateDoc });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'student not found' });

        const updatedUser = await usersCollection.findOne({ email }, { projection: { password: 0 } });
        res.json(updatedUser);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
      }
    });



    //// tutor profile
    app.get('/api/tutor/profile', verifyToken, verifyRole('tutor'), async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await usersCollection.findOne({ email, role: 'tutor' }, { projection: { password: 0 } });
        if (!user) return res.status(404).json({ error: 'tutor not found' });

        res.json(user);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // for update student profile
    // Expect JSON body: { email, name, photo }
    // Email required to identify user
    app.put('/api/tutor/profile', verifyToken, verifyRole('tutor'), async (req, res) => {
      try {
        const { email, name, photo } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const updateDoc = {};
        if (name) updateDoc.name = name;
        if (photo) updateDoc.photo = photo;

        const result = await usersCollection.updateOne({ email, role: 'tutor' }, { $set: updateDoc });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'tutor not found' });

        const updatedUser = await usersCollection.findOne({ email }, { projection: { password: 0 } });
        res.json(updatedUser);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
      }
    });





    // GET /users/tutors - Get all tutors with optional search
    // Example using Express.js and MongoDB native driver

    app.get("/users/tutors", async (req, res) => {
      try {
        const { search } = req.query;

        // Base query: Only tutors
        let query = { role: "tutor" };

        // If search query provided, match name using case-insensitive regex
        if (search) {
          const regex = new RegExp(search, "i");
          query.name = { $regex: regex };
        }

        // Fetch from MongoDB
        const tutors = await usersCollection.find(query).toArray();

        res.status(200).json(tutors); // Send full data array
      } catch (error) {
        console.error("Failed to fetch tutors:", error.message);
        res.status(500).json({ message: "Failed to fetch tutors", error: error.message });
      }
    });




    // GET /users/search?keyword=xyz
    app.get("/users/search", verifyToken, verifyRole('admin'), async (req, res) => {
      try {
        const keyword = req.query.keyword?.trim();

        if (!keyword) {
          return res
            .status(400)
            .json({ message: "Search keyword is required." });
        }

        const regex = new RegExp(keyword, "i"); // "i" = case-insensitive

        const users = await usersCollection
          .find({
            $or: [{ name: { $regex: regex } }, { email: { $regex: regex } }],
          })
          .toArray(); // Exclude sensitive fields

        res.status(200).json(users);
      } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });



    // GET /users?search=keyword
    app.get("/users", verifyToken, verifyRole('admin'), async (req, res) => {
      const search = req.query.search;
      if (!search) {
        return res.status(400).json({ message: "Search keyword is required" });
      }
      const regex = new RegExp(search, "i");
      const query = search
        ? {
          $or: [
            { name: { $regex: regex, $options: "i" } },
            { email: { $regex: regex, $options: "i" } },
          ],
        }
        : {};

      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });



    app.get("/users/role", verifyToken, async (req, res) => {
      const email = req.query.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });



    // ✅ New API: Get full user info by email
    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      try {
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json(user);
      } catch (error) {
        console.error("Failed to fetch user by email:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });






    // PATCH /users/role/:id
    app.patch("/users/role/:id", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );

      res.send(result);
    });

    // ****************Study Session related APIs************
    // ****************Study Session related APIs************
    // ****************Study Session related APIs************
    // ****************Study Session related APIs************

    // to get all session in an array

   app.get('/sessions/all/admin', verifyToken, verifyRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;      // default page = 1
    const limit = parseInt(req.query.limit) || 5;    // default limit = 5
    const skip = (page - 1) * limit;

    // Filter out rejected sessions (যেমন তুমি চেয়েছো)
    const filter = { status: { $ne: 'rejected' } };

    // মোট ডকুমেন্ট কাউন্ট (non-rejected)
    const totalCount = await sessionsCollection.countDocuments(filter);

    // পেজ অনুযায়ী ডাটা নিয়ে আসা (Cursor থেকে Array তে রূপান্তর)
    const sessions = await sessionsCollection.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }) // নতুন থেকে পুরানো সাজাতে
      .toArray();              // <<< এটা লাগবে

    res.json({
      sessions,
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});



    

    // GET /sessions?tutorEmail=example@example.com
    app.get("/sessions", verifyToken, verifyRole('tutor'), async (req, res) => {
      try {
        const { tutorEmail } = req.query;

        if (!tutorEmail) {
          return res
            .status(400)
            .json({ error: "tutorEmail query param is required" });
        }

        const sessions = await sessionsCollection
          .find({ tutorEmail })
          .sort({ createdAt: -1 }) // optional: latest first
          .toArray();

        res.status(200).json(sessions);
      } catch (error) {
        console.error("Error fetching tutor sessions:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // get only 6 card of study session usning limit and filtering

    app.get("/sessions/home", async (req, res) => {
      try {
        const sessions = await sessionsCollection
          .find({ status: "approved" })
          .sort({ createdAt: -1 }) // latest first
          .limit(6)
          .toArray();

        res.status(200).json(sessions);
      } catch (error) {
        console.error("Failed to fetch sessions:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Re apply for rejected applicatons in tutor dashborad

    app.patch("/sessions/reapply/:id", async (req, res) => {
      const { id } = req.params;
      const { status, isResubmitted } = req.body;

      try {
        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id), status: "rejected" },
          {
            $set: {
              status,
              isResubmitted,
              resubmittedAt: new Date(), // Optional: tracking
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.status(200).json({ modifiedCount: result.modifiedCount });
        } else {
          res
            .status(404)
            .json({ message: "Session not found or not rejected" });
        }
      } catch (error) {
        console.error("Reapply request failed:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // to approve study session status

    app.patch("/sessions/approve/:id", async (req, res) => {
      const { id } = req.params;
      const { registrationFee } = req.body;

      const result = await sessionsCollection.updateOne(
        { _id: new ObjectId(id), status: "pending" },
        {
          $set: {
            status: "approved",
            registrationFee: Number(registrationFee) || 0,
          },
        }
      );
      res.send(result);
    });

    // to reject study session amont or data

    app.patch("/sessions/reject/:id", async (req, res) => {
      const { id } = req.params;
      const { status, rejectionReason, feedback } = req.body;

      try {
        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          {
            $set: {
              status,
              rejectionReason,
              feedback,
              rejectedAt: new Date(), // Optional: rejection time tracking
            },
          }
        );
        res.send(result);
      } catch (error) {
        console.error("Reject API error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // to delete study session

    app.delete("/sessions/:id", async (req, res) => {
      const { id } = req.params;
      const result = await sessionsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });



    // Create Study Seccion for Tutor
    app.post("/sessions", async (req, res) => {
      try {
        const sessionData = req.body;

        // Optionally add server-side checks or defaults here
        if (!sessionData.tutorEmail || !sessionData.sessionTitle) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        console.log(sessionData);

        const result = await sessionsCollection.insertOne(sessionData);

        if (result.insertedId) {
          return res.status(201).json({ insertedId: result.insertedId });
        } else {
          return res.status(500).json({ message: "Failed to create session" });
        }
      } catch (err) {
        console.error("Error creating session:", err);
        return res.status(500).json({ message: "Internal server error" });
      }
    });

    // ✅ /sessions/all?search=math&page=1&limit=6
    // GET /sessions/all with pagination, search, and filtering
    // Updated /sessions/all endpoint with better infinite scroll support
    app.get("/sessions/all", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1; // Default to page 1
        const limit = parseInt(req.query.limit) || 10; // Default limit
        const search = req.query.search || "";
        const category = req.query.category || "";
        const status = req.query.status || "";

        console.log("Page:", page, "Limit:", limit);

        if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
          return res.status(400).json({
            success: false,
            message: "Invalid page or limit value",
          });
        }

        const query = {};

        if (search) {
          const regex = new RegExp(search, "i");
          query.$or = [
            { sessionTitle: { $regex: regex } },
            { description: { $regex: regex } },
            { tutorName: { $regex: regex } },
          ];
        }

        if (category) {
          query.category = category;
        }

        const now = new Date();

        if (status) {
          if (["approved", "pending", "rejected"].includes(status)) {
            query.status = status;
          } else {
            if (status === "upcoming") {
              query.registrationStartDate = { $exists: true, $gt: now };
            } else if (status === "ongoing") {
              query.registrationStartDate = { $exists: true, $lte: now };
              query.registrationEndDate = { $exists: true, $gte: now };
            } else if (status === "closed") {
              query.registrationEndDate = { $exists: true, $lt: now };
            }
          }
        }

        // check if collection has data
        const sample = await sessionsCollection.find({}).limit(1).toArray();
        console.log("Sample session:", sample);

        const total = await sessionsCollection.countDocuments(query);
        const skip = (page - 1) * limit;

        const sessions = await sessionsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).json({
          success: true,
          sessions,
          total,
          page,
          pageSize: limit,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + sessions.length < total,
        });
      } catch (error) {
        console.error("Error fetching sessions:", error);
        console.error(error.stack);
        res.status(500).json({
          success: false,
          message: "Failed to fetch sessions",
          error: error.message,
        });
      }
    });




    // Assuming you have already connected to MongoDB and have a sessions collection
    app.get("/sessions/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const session = await sessionsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!session) {
          return res.status(404).json({ error: "Study session not found" });
        }

        res.json(session);
      } catch (err) {
        console.error("Error fetching session by ID:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ************reviews get************

    app.get("/reviews", async (req, res) => {
      const { sessionId } = req.query;

      try {
        if (!sessionId) {
          return res.status(400).json({ error: "sessionId is required" });
        }

        const reviews = await reviewsCollection
          .find({ sessionId: sessionId })
          .sort({ createdAt: -1 }) // optional: latest review first
          .toArray();

        res.status(200).json(reviews);
      } catch (err) {
        console.error("Failed to fetch reviews:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Add this in your backend
    app.post("/reviews", async (req, res) => {
      const review = req.body;

      if (
        !review.sessionId ||
        !review.studentEmail ||
        !review.rating ||
        !review.comment
      ) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      review.createdAt = new Date(); // optional, for sorting

      try {
        const result = await reviewsCollection.insertOne(review);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (error) {
        console.error("Failed to insert review:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // -----------------

    // POST: Book a study session
    app.post("/bookedSessions", async (req, res) => {
      try {
        const {
          sessionId,
          studentEmail,
          tutorEmail,
          sessionTitle,
          tutorName,
          registrationFee,
          classStartDate,
          classEndDate,
          status,
        } = req.body;

        // Basic validation
        if (!sessionId || !studentEmail || !tutorEmail || !sessionTitle) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // ✅ Check if already booked by this user for this session
        const existingBooking = await bookedSessionCollection.findOne({
          sessionId,
          studentEmail,
        });

        if (existingBooking) {
          return res
            .status(409)
            .json({ message: "You have already booked this session." });
        }

        // Proceed with booking
        const bookingData = {
          sessionId,
          studentEmail,
          tutorEmail,
          sessionTitle,
          tutorName,
          registrationFee,
          classStartDate,
          classEndDate,
          status: status || "booked",
          bookedAt: new Date(),
        };

        const result = await bookedSessionCollection.insertOne(bookingData);
        res.status(201).json({
          message: "Session booked successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Booking failed:", error);
        res.status(500).json({ message: "Failed to book session" });
      }
    });

    // to get bookedSession by user email
    app.get("/bookedSession/user", verifyToken, verifyRole('student'), async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const bookings = await bookedSessionCollection
          .find({ studentEmail: email })
          .sort({ bookedAt: -1 }) // Optional: recent bookings first
          .toArray();

        res.status(200).json(bookings);
      } catch (error) {
        console.error("Failed to fetch bookings:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    });

    // *********update patch******************

    // In your server routes file (e.g., sessions.routes.js)
    app.patch("/update/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;

        if (
          !updateData.sessionTitle ||
          !updateData.registrationStartDate ||
          !updateData.registrationEndDate
        ) {
          return res
            .status(400)
            .json({ message: "Required fields are missing" });
        }

        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Session not found" });
        }

        if (result.modifiedCount === 0) {
          return res.status(200).json({ message: "No changes were made" });
        }

        res.status(200).json({ message: "Update successful", result });
      } catch (error) {
        console.error("Error updating session:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });



    // Example Express route
    app.get("/bookedSessions/check", async (req, res) => {
      // ✅ এই path frontend এ match করবে
      try {
        const { studentEmail, sessionId } = req.query;
        const booking = await bookedSessionCollection.findOne({
          studentEmail,
          sessionId,
        });
        res.status(200).json(booking ? [booking] : []);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // ******student note related**********
    // POST /notes - Create a new note
    app.post("/notes", async (req, res) => {
      try {
        const { email, title, description } = req.body;

        // Validation
        if (!email || !title || !description) {
          return res.status(400).json({
            success: false,
            message: "All fields are required (email, title, description)",
          });
        }

        const newNote = {
          email,
          title,
          description,
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "active",
        };

        const result = await notesCollection.insertOne(newNote);

        res.status(201).json({
          success: true,
          message: "Note created successfully",
          insertedId: result.insertedId,
          note: newNote,
        });
      } catch (error) {
        console.error("Error creating note:", error);
        res.status(500).json({
          success: false,
          message: "Failed to create note",
          error: error.message,
        });
      }
    });

    // GET /notes - Get all notes for a user with search functionality
    app.get("/notes", verifyToken, verifyRole('student'), async (req, res) => {
      try {
        const { email, search } = req.query;

        if (!email) {
          return res.status(400).json({
            success: false,
            message: "Email is required",
          });
        }

        // Build query with optional search
        const query = { email };
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
          ];
        }

        const notes = await notesCollection
          .find(query)
          .sort({ createdAt: -1 }) // Newest first
          .toArray();

        res.status(200).json({
          success: true,
          data: notes,
        });
      } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch notes",
          error: error.message,
        });
      }
    });

    // GET /notes/:id - Get single note by ID
    app.get("/notes/:id", verifyToken, verifyRole('student'), async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid note ID",
          });
        }

        const note = await notesCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!note) {
          return res.status(404).json({
            success: false,
            message: "Note not found",
          });
        }

        res.status(200).json({
          success: true,
          data: note,
        });
      } catch (error) {
        console.error("Error fetching note:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch note",
          error: error.message,
        });
      }
    });

    // PATCH /notes/:id - Update a note
    app.patch("/notes/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { title, description } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid note ID",
          });
        }

        if (!title && !description) {
          return res.status(400).json({
            success: false,
            message:
              "At least one field (title or description) is required for update",
          });
        }

        const updateFields = {
          updatedAt: new Date(),
        };

        if (title) updateFields.title = title;
        if (description) updateFields.description = description;

        const result = await notesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Note not found",
          });
        }

        res.status(200).json({
          success: true,
          message: "Note updated successfully",
          updatedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Error updating note:", error);
        res.status(500).json({
          success: false,
          message: "Failed to update note",
          error: error.message,
        });
      }
    });

    // DELETE /notes/:id - Delete a note
    app.delete("/notes/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid note ID",
          });
        }

        const result = await notesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Note not found or already deleted",
          });
        }

        res.status(200).json({
          success: true,
          message: "Note deleted successfully",
        });
      } catch (error) {
        console.error("Error deleting note:", error);
        res.status(500).json({
          success: false,
          message: "Failed to delete note",
          error: error.message,
        });
      }
    });

    // *************************Materials api*********************************

    // routes/materials.js or inside app.post('/materials', ...)
    app.post("/materials", async (req, res) => {
      try {
        const { title, imageUrl, sessionId, tutorEmail, resourceLinks } =
          req.body;

        // basic validation
        if (
          !title ||
          !imageUrl ||
          !sessionId ||
          !tutorEmail ||
          !resourceLinks?.length
        ) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const material = {
          title,
          imageUrl,
          sessionId,
          tutorEmail,
          resourceLinks, // accepts [{url, type}, ...]
          uploadedAt: new Date(),
        };

        const result = await materialsCollection.insertOne(material);
        res.status(201).json({
          message: "Material uploaded",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Material upload error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // GET materials for a tutor
    app.get("/materials", verifyToken, verifyRole('tutor'), async (req, res) => {
      try {
        const { tutorEmail } = req.query;
        if (!tutorEmail) {
          return res
            .status(400)
            .json({ message: "tutorEmail query param is required" });
        }

        const materials = await materialsCollection
          .find({ tutorEmail })
          .sort({ uploadedAt: -1 })
          .toArray();

        res.status(200).json(materials);
      } catch (error) {
        console.error("Error fetching materials:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // DELETE material by ID
    app.delete("/materials/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid material ID" });
        }

        const result = await materialsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ message: "Material not found or already deleted" });
        }

        res.status(200).json({ message: "Material deleted successfully" });
      } catch (error) {
        console.error("Error deleting material:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // PATCH (update) material by ID
    app.patch("/materials/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { title, resourceLinks } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid material ID" });
        }

        if (!title || !Array.isArray(resourceLinks)) {
          return res
            .status(400)
            .json({ message: "Title and resourceLinks are required" });
        }

        const updateData = {
          title,
          resourceLinks,
          // Optionally update updatedAt field if you want
          updatedAt: new Date(),
        };

        const result = await materialsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Material not found" });
        }

        res.status(200).json({ message: "Material updated successfully" });
      } catch (error) {
        console.error("Error updating material:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Optional: Specific API only for students
    // FIXED ✅✅✅
    app.get("/student/materials", verifyToken, async (req, res) => {
      try {
        const { sessionId } = req.query;

        if (!sessionId) {
          return res.status(400).json({ message: "sessionId is required" });
        }

        const materials = await materialsCollection
          .find({ sessionId })
          .sort({ uploadedAt: -1 })
          .toArray();

        res.status(200).json(materials);
      } catch (error) {
        console.error("Error fetching materials for student:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // ✅ Booked sessions for a student by email
    app.get("/bookedSession/user", async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const bookings = await bookedSessionCollection
          .find({ studentEmail: email })
          .sort({ bookedAt: -1 }) // সর্বশেষ বুকিং আগে দেখাবে
          .toArray();

        res.status(200).json(bookings);
      } catch (error) {
        console.error("Failed to fetch bookings:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    });

    // ✅ Admin: Get all materials without filtering by tutorEmail
    app.get("/admin/materials", async (req, res) => {
      try {
        const materials = await materialsCollection
          .find({})
          .sort({ uploadedAt: -1 })
          .toArray();

        res.status(200).json(materials);
      } catch (error) {
        console.error("Error fetching all materials for admin:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // DELETE a material by ID
    app.delete("/materials/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid material ID" });
        }

        const result = await materialsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ message: "Material not found or already deleted" });
        }

        res.status(200).json({ message: "Material deleted successfully" });
      } catch (error) {
        console.error("Error deleting material:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // all tutors api*********************************








    // ***********************admin dashboard**********************

    app.get("/sessions/admin", async (req, res) => {
      try {
        // Optional Query Params
        const search = req.query.search || "";
        const status = req.query.status || "";
        const category = req.query.category || "";

        const query = {};

        // Optional Search Filter (title, description, tutorName)
        if (search) {
          query.$or = [
            { sessionTitle: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
            { tutorName: { $regex: search, $options: "i" } },
          ];
        }

        // Optional Status Filter (approved, pending, rejected)
        if (status) {
          query.status = status;
        }

        // Optional Category Filter
        if (category) {
          query.category = category;
        }

        const sessions = await sessionsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(sessions);
      } catch (error) {
        console.error("Error fetching admin sessions:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch admin sessions",
          error: error.message,
        });
      }
    });





    // ✅ BACKEND: Get student dashboard overview
    // Endpoint: GET /dashboard/student-overview?email=student@gmail.com

    app.get('/dashboard/student-overview', async (req, res) => {
      try {
        const studentEmail = req.query.email;
        if (!studentEmail) return res.status(400).json({ error: 'Student email is required' });

        const [bookedSessions, reviews, notes, materials] = await Promise.all([
          bookedSessionCollection.find({ studentEmail }).toArray(),
          reviewsCollection.find({ studentEmail }).toArray(),
          notesCollection.find({ email: studentEmail }).toArray(),
          materialsCollection.find({ uploadedBy: studentEmail }).toArray() // optional condition
        ]);

        // Optional: session titles for bar/pie chart
        const sessionBookingCount = {};
        bookedSessions.forEach((session) => {
          sessionBookingCount[session.sessionTitle] = (sessionBookingCount[session.sessionTitle] || 0) + 1;
        });

        const totalSpent = bookedSessions.reduce((sum, b) => sum + parseFloat(b.registrationFee || 0), 0);

        const averageRating =
          reviews.length > 0
            ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
            : 0;

        res.json({
          totalBookedSessions: bookedSessions.length,
          totalReviews: reviews.length,
          totalNotes: notes.length,
          totalMaterials: materials.length,
          totalSpent,
          averageRating,
          sessionBookingCount,
        });
      } catch (err) {
        console.error('Student Dashboard Error:', err);
        res.status(500).json({ error: 'Server Error' });
      }
    });


















    // Send a ping to confirm a successful connection
    // // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// root route
app.get("/", (req, res) => {
  res.send("Study Sphere Server is running!");
});

// start the server

app.listen(PORT, () => {
  console.log(`Server is running on Port ${PORT}`);
});
