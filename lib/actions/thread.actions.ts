"use server"

import { revalidatePath } from "next/cache";
import User from "@/lib/models/user.model";
import { connectToDB } from "@/lib/mongoose"
import Thread from "@/lib/models/thread.model";
import Community from "@/lib/models/community.model";


interface Params {
    text: string,
    author: string,
    communityId: string | null,
    path: string,
}
export async function createThread({ text, author, communityId, path }: Params): Promise<void> {
    try {
        connectToDB();
    
        const communityIdObject = await Community.findOne(
          { id: communityId },
          { _id: 1 }
        );
    
        const createdThread = await Thread.create({
          text,
          author,
          community: communityIdObject, // Assign communityId if provided, or leave it null for personal account
        });
    
        // Update User model
        await User.findByIdAndUpdate(author, {
          $push: { threads: createdThread._id },
        });
    
        if (communityIdObject) {
          // Update Community model
          await Community.findByIdAndUpdate(communityIdObject, {
            $push: { threads: createdThread._id },
          });
        }
    
        revalidatePath(path);
      } catch (error: any) {
        throw new Error(`Failed to create thread: ${error.message}`);
      }
}

export async function fetchPosts(pageNumber = 1, pageSize = 20) {
    connectToDB();

    // Calculate the number of posts to skip
    const skipAmount = (pageNumber - 1) * pageSize;

    // Fetch the posts that have no parents (top-level threads...)
    const postQuery =  Thread.find({ parentId: { $in: [null, undefined] } })
    .sort({ createdAt: 'desc' })
    .skip(skipAmount)
    .limit(pageSize)
    .populate({ path: 'author', model: User })
    .populate({
        path: "community",
        model: Community,
      })
    .populate({ 
        path: 'children', 
        model: User,
        select: "_id name parentId image"
    })

    const totalPostCount = await Thread.countDocuments({ parentId: { $in: [null, undefined] } })

    const posts = await postQuery.exec();

    const isNext = totalPostCount > skipAmount + posts.length;

    return { posts, isNext }
}

export async function fetchThreadById(id: string) {
    try {

        // TODO: Populate Community
        const thread = await Thread.findById(id)
            .populate({
                path: 'author',
                model: 'User',
                select: '_id id name image'
            })
            .populate({
                path: 'children',
                populate: [
                    {
                        path: 'author',
                        model: User,
                        select: "_id id name parentId image"
                    },
                    {
                        path: 'children',
                        model: Thread,
                        populate: {
                            path: 'author',
                            model: User,
                            select: "_id id name parentId image"
                        }
                    }
                ]
            }).exec();
        return thread;
    } catch (error: any) {
        throw new Error(`Error fetching thread: ${error.message}`)
    }
}

export async function addCommentToThread(
    threadId:string,
    commentText: string,
    userId: string,
    path: string
) {
    connectToDB();
    try {
        // Find the original thread by its ID

        const originalThread = await Thread.findById(threadId);

        if(!originalThread) {
            throw new Error("Thread not found!");
        }


        // Create a new thread with the comment text
        const commentThread = new Thread({
            text: commentText,
            author: userId,
            parentId: threadId
        });

        // Save the new thread
        const savedCommentThread = await commentThread.save()

        // Update the original thread to include the new comment
        originalThread.children.push(savedCommentThread._id)

        // Save the original thread
        await originalThread.save();

        revalidatePath(path)

    } catch (error: any) {
        throw new Error(`Error adding comment to thread: ${error.message}`)
    }
}